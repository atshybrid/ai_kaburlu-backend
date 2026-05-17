#!/bin/bash
set -e

echo "🔍 PostgreSQL Diagnostics & Fix"
echo "================================"

# Check if PostgreSQL is installed
echo ""
echo "1️⃣ Checking PostgreSQL installation..."
if command -v psql &> /dev/null; then
    echo "✅ psql found: $(psql --version)"
else
    echo "❌ PostgreSQL not found. Installing..."
    apt-get update
    apt-get install -y postgresql postgresql-contrib
fi

# Check actual PostgreSQL processes
echo ""
echo "2️⃣ Checking PostgreSQL processes..."
if pgrep -x "postgres" > /dev/null; then
    echo "✅ PostgreSQL daemon is running"
    ps aux | grep postgres | grep -v grep
else
    echo "❌ PostgreSQL daemon is NOT running"
fi

# Check systemd unit file
echo ""
echo "3️⃣ Checking systemd unit configuration..."
UNIT_FILE="/usr/lib/systemd/system/postgresql.service"
if [ -f "$UNIT_FILE" ]; then
    echo "Unit file exists: $UNIT_FILE"
    echo "Current ExecStart:"
    grep "ExecStart=" "$UNIT_FILE"
else
    echo "❌ Unit file not found at $UNIT_FILE"
fi

# Check postgresql service status
echo ""
echo "4️⃣ Current PostgreSQL service status..."
systemctl status postgresql --no-pager || true

# Fix: Start PostgreSQL properly
echo ""
echo "5️⃣ Attempting to start PostgreSQL..."
if ! pgrep -x "postgres" > /dev/null; then
    echo "Starting PostgreSQL via sudo..."
    sudo -u postgres /usr/lib/postgresql/*/bin/postgres -D /var/lib/postgresql/*/main -c config_file=/etc/postgresql/*/main/postgresql.conf &
    sleep 2
    
    if pgrep -x "postgres" > /dev/null; then
        echo "✅ PostgreSQL started successfully"
    else
        echo "⚠️  PostgreSQL may not have started. Trying alternative method..."
        service postgresql start || sudo service postgresql start
        sleep 2
    fi
fi

# Test connection
echo ""
echo "6️⃣ Testing database connection..."
if psql -U postgres -d postgres -c "SELECT version();" 2>/dev/null; then
    echo "✅ Database connection successful"
else
    echo "❌ Cannot connect to database"
    echo "Trying to connect with sudo..."
    sudo -u postgres psql -d postgres -c "SELECT version();" || true
fi

echo ""
echo "================================"
echo "Diagnostics complete"
