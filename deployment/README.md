# RAF NET CCTV Production Deployment

This folder contains all the necessary files to deploy the RAF NET CCTV application to an Ubuntu 20.04 server.

## Server Details
- **IP Address**: 172.17.11.12
- **Frontend**: [https://cctv.raf.my.id](https://cctv.raf.my.id)
- **Backend/Stream**: [https://api-cctv.raf.my.id](https://api-cctv.raf.my.id)

## Deployment Steps

1. **Prepare the Server**:
   Ensure you have a clean Ubuntu 20.04 installation and SSH access.

2. **Upload Files**:
   Upload the entire project directory to `/var/www/rafnet-cctv` on your server.

3. **Run the Installer**:
   ```bash
   cd /var/www/rafnet-cctv/deployment
   chmod +x install.sh
   ./install.sh
   ```

4. **Setup SSL (HTTPS)**:
   The installer installs Certbot. Run the following command to secure your domains:
   ```bash
   sudo certbot --nginx -d cctv.raf.my.id -d api-cctv.raf.my.id
   ```

5. **Firewall Setup**:
   Ensure the following ports are open:
   - `80` (HTTP)
   - `443` (HTTPS)
   - `1935` (RTMP - for camera input)
   - `8888` (HLS - for streaming)
   - `8889` (WebRTC - for low latency streaming)
   - `9997` (MediaMTX API - internal use)

## File Structure
- `install.sh`: Main automation script.
- `update.sh`: Script to pull changes and restart services.
- `nginx.conf`: Nginx server block configuration.
- `mediamtx.yml`: MediaMTX production configuration.
- `backend.env.prod`: Production environment variables for the backend.
- `frontend.env.prod`: Production environment variables for the frontend.
- `ecosystem.config.cjs`: PM2 process management configuration.

## GitHub Integration & Updates

### 1. Initial Setup (Local Machine)
To upload your code to GitHub:
```bash
git init
git remote add origin https://github.com/rafall04/cctv.git
git add .
git commit -m "Initial production-ready commit"
git branch -M main
git push -u origin main
```

### 2. Connect Existing Server to Git
Since you already uploaded files manually, run these on your server to link it to GitHub without re-installing:
```bash
cd /var/www/rafnet-cctv
git init
git remote add origin https://github.com/rafall04/cctv.git
git fetch
git checkout -f main
git branch --set-upstream-to=origin/main main
```
*Note: `git checkout -f main` will overwrite local files with the ones from GitHub. Your `.env` and `data/` files are safe because they are in `.gitignore`.*

### 3. How to Update
Whenever you push new changes to GitHub, just run this on your server:
```bash
cd /var/www/rafnet-cctv/deployment
chmod +x update.sh
./update.sh
```

## Maintenance
- **View Logs**: `pm2 logs`
- **Check Status**: `pm2 list`
- **Restart All**: `pm2 restart all`
