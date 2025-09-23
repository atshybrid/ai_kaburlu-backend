import { EventEmitter } from 'events';
import { sendToTokensEnhanced, sendToUserEnhanced, sendToTopicEnhanced } from './fcm-enhanced';
import type { PushNotificationPayload, NotificationOptions } from './fcm-enhanced';

// Queue job types
export interface QueueJob {
  id: string;
  type: 'tokens' | 'user' | 'topic';
  payload: PushNotificationPayload;
  targets: string[] | string; // tokens array, userId, or topic name
  options: NotificationOptions;
  priority: 'low' | 'normal' | 'high';
  createdAt: Date;
  scheduledAt?: Date;
  retryCount: number;
  maxRetries: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  batchId?: string;
}

export interface QueueMetrics {
  totalJobs: number;
  pendingJobs: number;
  processingJobs: number;
  completedJobs: number;
  failedJobs: number;
  averageProcessingTime: number;
  throughputPerMinute: number;
}

export interface BatchOptions {
  batchSize?: number;
  batchDelay?: number; // milliseconds between batches
  priority?: 'low' | 'normal' | 'high';
  maxRetries?: number;
}

class NotificationQueue extends EventEmitter {
  private queue: QueueJob[] = [];
  private processing = false;
  private processingJob: QueueJob | null = null;
  private rateLimiter = {
    tokensPerMinute: 500, // FCM rate limit
    currentCount: 0,
    windowStart: Date.now()
  };
  private metrics = {
    totalProcessed: 0,
    totalFailed: 0,
    totalProcessingTime: 0,
    lastMinuteCount: 0,
    lastMinuteStart: Date.now()
  };

  constructor() {
    super();
    this.startProcessing();
    
    // Reset rate limiter every minute
    setInterval(() => {
      this.resetRateLimiter();
    }, 60000);
  }

  // Add single job to queue
  public async addJob(
    type: 'tokens' | 'user' | 'topic',
    targets: string[] | string,
    payload: PushNotificationPayload,
    options: NotificationOptions & { priority?: 'low' | 'normal' | 'high'; maxRetries?: number } = {}
  ): Promise<string> {
    const jobId = this.generateJobId();
    
    const job: QueueJob = {
      id: jobId,
      type,
      payload,
      targets,
      options,
      priority: options.priority || 'normal',
      createdAt: new Date(),
      scheduledAt: options.scheduledAt,
      retryCount: 0,
      maxRetries: options.maxRetries || 3,
      status: 'pending',
      batchId: options.batchId
    };

    this.insertJobByPriority(job);
    
    console.log(`[Queue] Added ${type} job: ${jobId}`, {
      targets: Array.isArray(targets) ? targets.length : 1,
      priority: job.priority,
      queueSize: this.queue.length
    });

    this.emit('jobAdded', job);
    return jobId;
  }

  // Add batch of jobs with automatic batching
  public async addBatchJobs(
    type: 'tokens',
    allTargets: string[],
    payload: PushNotificationPayload,
    batchOptions: BatchOptions = {}
  ): Promise<string[]> {
    const {
      batchSize = 100, // FCM allows up to 500 tokens per request
      batchDelay = 1000, // 1 second between batches
      priority = 'normal',
      maxRetries = 3
    } = batchOptions;

    const batchId = this.generateBatchId();
    const jobIds: string[] = [];
    
    // Split targets into batches
    const batches: string[][] = [];
    for (let i = 0; i < allTargets.length; i += batchSize) {
      batches.push(allTargets.slice(i, i + batchSize));
    }

    console.log(`[Queue] Creating batch operation: ${batchId}`, {
      totalTargets: allTargets.length,
      batchCount: batches.length,
      batchSize,
      batchDelay
    });

    // Create jobs for each batch
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const scheduledAt = new Date(Date.now() + (i * batchDelay));
      
      const jobId = await this.addJob(type, batch, payload, {
        priority,
        maxRetries,
        batchId,
        scheduledAt,
        sourceController: 'batch-operation',
        sourceAction: `batch-${i + 1}-of-${batches.length}`
      });
      
      jobIds.push(jobId);
    }

    this.emit('batchCreated', { batchId, jobIds, totalJobs: batches.length });
    return jobIds;
  }

  // Get job status
  public getJobStatus(jobId: string): QueueJob | null {
    return this.queue.find(job => job.id === jobId) || null;
  }

  // Get batch status
  public getBatchStatus(batchId: string): {
    batchId: string;
    jobs: QueueJob[];
    totalJobs: number;
    completedJobs: number;
    failedJobs: number;
    pendingJobs: number;
    processingJobs: number;
  } {
    const jobs = this.queue.filter(job => job.batchId === batchId);
    
    return {
      batchId,
      jobs,
      totalJobs: jobs.length,
      completedJobs: jobs.filter(j => j.status === 'completed').length,
      failedJobs: jobs.filter(j => j.status === 'failed').length,
      pendingJobs: jobs.filter(j => j.status === 'pending').length,
      processingJobs: jobs.filter(j => j.status === 'processing').length
    };
  }

  // Cancel job
  public cancelJob(jobId: string): boolean {
    const jobIndex = this.queue.findIndex(job => job.id === jobId);
    if (jobIndex === -1) return false;
    
    const job = this.queue[jobIndex];
    if (job.status === 'processing') {
      console.warn(`[Queue] Cannot cancel job in progress: ${jobId}`);
      return false;
    }
    
    job.status = 'cancelled';
    console.log(`[Queue] Cancelled job: ${jobId}`);
    this.emit('jobCancelled', job);
    return true;
  }

  // Cancel batch
  public cancelBatch(batchId: string): number {
    const jobs = this.queue.filter(job => job.batchId === batchId);
    let cancelledCount = 0;
    
    for (const job of jobs) {
      if (job.status === 'pending') {
        job.status = 'cancelled';
        cancelledCount++;
      }
    }
    
    console.log(`[Queue] Cancelled ${cancelledCount} jobs in batch: ${batchId}`);
    this.emit('batchCancelled', { batchId, cancelledCount });
    return cancelledCount;
  }

  // Get queue metrics
  public getMetrics(): QueueMetrics {
    const now = Date.now();
    
    // Calculate throughput for last minute
    if (now - this.metrics.lastMinuteStart >= 60000) {
      this.metrics.lastMinuteCount = 0;
      this.metrics.lastMinuteStart = now;
    }

    return {
      totalJobs: this.queue.length,
      pendingJobs: this.queue.filter(j => j.status === 'pending').length,
      processingJobs: this.queue.filter(j => j.status === 'processing').length,
      completedJobs: this.queue.filter(j => j.status === 'completed').length,
      failedJobs: this.queue.filter(j => j.status === 'failed').length,
      averageProcessingTime: this.metrics.totalProcessed > 0 
        ? this.metrics.totalProcessingTime / this.metrics.totalProcessed 
        : 0,
      throughputPerMinute: this.metrics.lastMinuteCount
    };
  }

  // Clean completed jobs (keep for analysis)
  public cleanupCompletedJobs(olderThanHours = 24): number {
    const cutoffTime = new Date(Date.now() - (olderThanHours * 60 * 60 * 1000));
    const initialLength = this.queue.length;
    
    this.queue = this.queue.filter(job => 
      job.status !== 'completed' || job.createdAt > cutoffTime
    );
    
    const removedCount = initialLength - this.queue.length;
    if (removedCount > 0) {
      console.log(`[Queue] Cleaned up ${removedCount} completed jobs older than ${olderThanHours}h`);
    }
    
    return removedCount;
  }

  // Private methods
  private generateJobId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateBatchId(): string {
    return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private insertJobByPriority(job: QueueJob) {
    const priorityOrder = { high: 0, normal: 1, low: 2 };
    
    // Find insertion point based on priority
    let insertIndex = this.queue.length;
    for (let i = 0; i < this.queue.length; i++) {
      const existingJob = this.queue[i];
      if (existingJob.status !== 'pending') continue;
      
      if (priorityOrder[job.priority] < priorityOrder[existingJob.priority]) {
        insertIndex = i;
        break;
      }
    }
    
    this.queue.splice(insertIndex, 0, job);
  }

  private async startProcessing() {
    if (this.processing) return;
    this.processing = true;

    while (this.processing) {
      try {
        const job = this.getNextJob();
        if (!job) {
          await this.sleep(1000); // Wait 1 second if no jobs
          continue;
        }

        // Check if scheduled for future
        if (job.scheduledAt && job.scheduledAt > new Date()) {
          await this.sleep(1000);
          continue;
        }

        // Check rate limiting
        if (!this.canProcessJob()) {
          await this.sleep(1000);
          continue;
        }

        await this.processJob(job);
        
      } catch (error) {
        console.error('[Queue] Processing error:', error);
        await this.sleep(5000); // Wait 5 seconds on error
      }
    }
  }

  private getNextJob(): QueueJob | null {
    return this.queue.find(job => 
      job.status === 'pending' && 
      (!job.scheduledAt || job.scheduledAt <= new Date())
    ) || null;
  }

  private canProcessJob(): boolean {
    const now = Date.now();
    
    // Reset rate limiter window if needed
    if (now - this.rateLimiter.windowStart >= 60000) {
      this.rateLimiter.currentCount = 0;
      this.rateLimiter.windowStart = now;
    }
    
    return this.rateLimiter.currentCount < this.rateLimiter.tokensPerMinute;
  }

  private async processJob(job: QueueJob): Promise<void> {
    const startTime = Date.now();
    this.processingJob = job;
    job.status = 'processing';
    
    console.log(`[Queue] Processing job: ${job.id}`, {
      type: job.type,
      priority: job.priority,
      attempt: job.retryCount + 1,
      maxRetries: job.maxRetries
    });

    this.emit('jobStarted', job);

    try {
      let result: any;
      
      switch (job.type) {
        case 'tokens':
          result = await sendToTokensEnhanced(
            job.targets as string[],
            job.payload,
            job.options
          );
          break;
          
        case 'user':
          result = await sendToUserEnhanced(
            job.targets as string,
            job.payload,
            job.options
          );
          break;
          
        case 'topic':
          result = await sendToTopicEnhanced(
            job.targets as string,
            job.payload,
            job.options
          );
          break;
          
        default:
          throw new Error(`Unknown job type: ${job.type}`);
      }

      // Update rate limiter
      if (job.type === 'tokens') {
        this.rateLimiter.currentCount += (job.targets as string[]).length;
      } else {
        this.rateLimiter.currentCount += 1;
      }

      job.status = result.success ? 'completed' : 'failed';
      
      const processingTime = Date.now() - startTime;
      this.updateMetrics(processingTime, result.success);
      
      console.log(`[Queue] Job ${job.status}: ${job.id}`, {
        processingTime: `${processingTime}ms`,
        success: result.success,
        successCount: result.successCount,
        failureCount: result.failureCount
      });

      this.emit('jobCompleted', job, result);
      
    } catch (error: any) {
      console.error(`[Queue] Job failed: ${job.id}`, error);
      
      job.retryCount++;
      if (job.retryCount < job.maxRetries) {
        job.status = 'pending';
        job.scheduledAt = new Date(Date.now() + (job.retryCount * 5000)); // Exponential backoff
        console.log(`[Queue] Retrying job ${job.id} in ${job.retryCount * 5} seconds`);
        this.emit('jobRetry', job, error);
      } else {
        job.status = 'failed';
        this.emit('jobFailed', job, error);
      }
      
      const processingTime = Date.now() - startTime;
      this.updateMetrics(processingTime, false);
    } finally {
      this.processingJob = null;
    }
  }

  private updateMetrics(processingTime: number, success: boolean) {
    this.metrics.totalProcessed++;
    this.metrics.totalProcessingTime += processingTime;
    this.metrics.lastMinuteCount++;
    
    if (!success) {
      this.metrics.totalFailed++;
    }
  }

  private resetRateLimiter() {
    this.rateLimiter.currentCount = 0;
    this.rateLimiter.windowStart = Date.now();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Graceful shutdown
  public async shutdown(): Promise<void> {
    console.log('[Queue] Shutting down notification queue...');
    this.processing = false;
    
    // Wait for current job to complete
    if (this.processingJob) {
      console.log('[Queue] Waiting for current job to complete...');
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (!this.processingJob) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
      });
    }
    
    console.log('[Queue] Notification queue shut down successfully');
  }
}

// Singleton instance
export const notificationQueue = new NotificationQueue();

// Graceful shutdown handling
process.on('SIGINT', async () => {
  await notificationQueue.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await notificationQueue.shutdown();
  process.exit(0);
});