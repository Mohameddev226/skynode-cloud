# SkyNode Cloud — Deployment Guide

## Local Development

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 9.0.0
- Docker Desktop

### Steps

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:generate
pnpm db:push
pnpm dev
```

## Production Deployment (Self-Hosted)

### Requirements

- Linux server (Ubuntu 22.04+ recommended)
- Docker Engine + Docker Compose
- Domain name with DNS configured
- TLS certificate (Let's Encrypt or custom)

### Steps

1. **Server preparation**
   ```bash
   # Install Docker
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER

   # Install Node.js 20+
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs

   # Install pnpm
   npm install -g pnpm
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with PRODUCTION values:
   # - Generate random SESSION_SECRET (64+ chars)
   # - Generate random JWT_SECRET (64+ chars)
   # - Set strong database passwords
   # - Set COOKIE_SECURE=true
   # - Set NODE_ENV=production
   # - Update CORS_ORIGINS to your domain
   ```

3. **TLS certificates**
   ```bash
   mkdir -p infrastructure/nginx/ssl
   # Option A: Let's Encrypt
   certbot certonly --standalone -d yourdomain.com
   cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem infrastructure/nginx/ssl/cert.pem
   cp /etc/letsencrypt/live/yourdomain.com/privkey.pem infrastructure/nginx/ssl/key.pem

   # Option B: Self-signed (development/testing only)
   openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
     -keyout infrastructure/nginx/ssl/key.pem \
     -out infrastructure/nginx/ssl/cert.pem
   ```

4. **Build and deploy**
   ```bash
   pnpm install --frozen-lockfile
   pnpm build
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
   ```

5. **Firewall**
   ```bash
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw deny 5432/tcp   # Block external PostgreSQL
   sudo ufw deny 6379/tcp   # Block external Redis
   sudo ufw enable
   ```

### Production Checklist

- [ ] Strong, unique passwords for all services
- [ ] `COOKIE_SECURE=true`
- [ ] `NODE_ENV=production`
- [ ] TLS certificates installed
- [ ] PostgreSQL not exposed publicly
- [ ] Redis not exposed publicly
- [ ] Firewall configured
- [ ] Backup schedule configured
- [ ] Monitoring enabled
- [ ] Audit logging verified
