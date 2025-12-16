
import { Request, Response } from 'express';
import * as userService from './users.service';

export const createUser = async (req: Request, res: Response) => {
  try {
    const user = await userService.createUser(req.body);
    res.status(201).json({ success: true, data: user });
  } catch (error) {
        const msg = (error as Error).message || 'Internal server error';
        if (msg.toLowerCase().includes('mobile number already')) {
            return res.status(409).json({ success: false, message: msg });
        }
        res.status(500).json({ success: false, message: msg });
  }
};

export const getAllUsers = async (_req: Request, res: Response) => {
  try {
    const users = await userService.findAllUsers();
    res.status(200).json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, message: (error as Error).message });
  }
};

export const getUserById = async (req: Request, res: Response) => {
    try {
        const user = await userService.findUserById(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        res.status(200).json({ success: true, data: user });
    } catch (error) {
        res.status(500).json({ success: false, message: (error as Error).message });
    }
};

export const updateUser = async (req: Request, res: Response) => {
    try {
        const user = await userService.updateUser(req.params.id, req.body);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        res.status(200).json({ success: true, data: user });
    } catch (error) {
        const msg = (error as Error).message || 'Internal server error';
        if (msg.toLowerCase().includes('mobile number already')) {
            return res.status(409).json({ success: false, message: msg });
        }
        res.status(500).json({ success: false, message: msg });
    }
};

export const deleteUser = async (req: Request, res: Response) => {
    try {
        await userService.deleteUser(req.params.id);
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ success: false, message: (error as Error).message });
    }
};

export const upgradeGuest = async (req: Request, res: Response) => {
    try {
        const user = await userService.upgradeGuest(req.body);
        res.status(200).json({ success: true, data: user });
    } catch (error) {
        const msg = (error as Error).message || 'Internal server error';
        if (msg.toLowerCase().includes('invalid mobile')) {
            return res.status(400).json({ success: false, message: msg });
        }
        if (msg.toLowerCase().includes('mobile number already')) {
            return res.status(409).json({ success: false, message: msg });
        }
        res.status(500).json({ success: false, message: msg });
    }
};
