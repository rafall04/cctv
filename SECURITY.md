# RAF NET Secure CCTV Hub - Security Documentation

## Overview

This document outlines the security architecture and best practices for the RAF NET CCTV system.

## Core Security Principles

### 1. Camera IP Isolation

**Objective**: Prevent public exposure of private camera IP addresses.

**Implementation**:
- Camera RTSP URLs stored **server-side only** in SQLite database
- Frontend **never** receives RTSP URLs
- MediaMTX acts as a proxy, ingesting RTSP from private network
- Only WebRTC/HLS endpoints exposed to public

**Verification**:
```bash
# Check browser network tab - should never see RTSP URLs
# Only see: /api/stream/* endpoints returning HLS/WebRTC URLs
```

### 2. Network Segmentation

**Requirements**:
```
[Private VLAN] ← Cameras (192.168.x.x)
       ↓
[MediaMTX Host] ← Only this server can access cameras
       ↓
[Public Network] ← Users access WebRTC/HLS streams
```

**Configuration**:
- Cameras on isolated VLAN (no internet access)
- MediaMTX host has dual network interfaces:
  - Private interface: Access to camera VLAN
  - Public interface: Serve streams to users
- Firewall rules:
  - Block direct access to camera IPs from public
  - Allow only MediaMTX host to camera RTSP ports

### 3. Authentication & Authorization

**Public Access**:
- Camera viewing: **No authentication required**
- Stream endpoints: `/api/stream/*` (public)
- Camera list: `/api/cameras/active` (public)

**Admin Access**:
- Camera management: **JWT authentication required**
- Protected endpoints:
  - `POST /api/auth/login`
  - `GET /api/cameras` (all cameras)
  - `POST /api/cameras` (create)
  - `PUT /api/cameras/:id` (update)
  - `DELETE /api/cameras/:id` (delete)

**JWT Configuration**:
```env
JWT_SECRET=<strong-random-string>  # Change in production!
JWT_EXPIRATION=24h
```

**Password Security**:
- Passwords hashed with bcrypt (cost factor: 10)
- Default admin credentials:
  - Username: `admin`
  - Password: `admin123`
  - **⚠️ CHANGE IMMEDIATELY IN PRODUCTION**

### 4. Audit Logging

All admin actions are logged to `audit_logs` table:
- User login/logout
- Camera create/update/delete
- IP address tracking
- Timestamp

**Query logs**:
```sql
SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 50;
```

## Deployment Security Checklist

### Pre-Production

- [ ] Change default admin password
- [ ] Generate strong JWT secret (32+ characters)
- [ ] Configure firewall rules
- [ ] Set up network segmentation (camera VLAN)
- [ ] Enable HTTPS (reverse proxy with SSL/TLS)
- [ ] Restrict MediaMTX API access (firewall)
- [ ] Review CORS origins in backend config
- [ ] Disable debug logging in production

### Network Configuration

```nginx
# Example Nginx reverse proxy with SSL
server {
    listen 443 ssl http2;
    server_name cctv.yourcompany.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Frontend
    location / {
        root /path/to/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # MediaMTX HLS
    location /camera {
        proxy_pass http://localhost:8888;
        proxy_set_header Host $host;
        
        # CORS headers
        add_header Access-Control-Allow-Origin *;
        add_header Access-Control-Allow-Methods 'GET, OPTIONS';
    }

    # MediaMTX WebRTC
    location /webrtc {
        proxy_pass http://localhost:8889;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

### Firewall Rules

```bash
# Allow HTTPS
ufw allow 443/tcp

# Allow SSH (for management)
ufw allow 22/tcp

# Block direct access to backend
ufw deny 3000/tcp

# Block direct access to MediaMTX
ufw deny 8888/tcp
ufw deny 8889/tcp
ufw deny 9997/tcp

# Enable firewall
ufw enable
```

## Incident Response

### Unauthorized Access Detected

1. **Immediate Actions**:
   - Disable affected user account
   - Rotate JWT secret (forces all users to re-login)
   - Review audit logs for suspicious activity

2. **Investigation**:
   ```sql
   -- Check recent logins
   SELECT * FROM audit_logs WHERE action = 'LOGIN' ORDER BY created_at DESC;
   
   -- Check camera modifications
   SELECT * FROM audit_logs WHERE action LIKE '%CAMERA%' ORDER BY created_at DESC;
   ```

3. **Recovery**:
   - Change all admin passwords
   - Update JWT secret in `.env`
   - Restart backend server
   - Monitor logs for 24 hours

### Camera Stream Compromise

If camera RTSP URLs are exposed:

1. **Immediate**:
   - Change camera passwords
   - Update RTSP URLs in admin panel
   - Restart MediaMTX

2. **Long-term**:
   - Review network segmentation
   - Audit code for RTSP URL leaks
   - Implement additional monitoring

## Security Best Practices

### For Administrators

1. **Strong Passwords**: Use 16+ character passwords with mixed case, numbers, symbols
2. **Regular Updates**: Keep Node.js, dependencies, and MediaMTX updated
3. **Monitor Logs**: Review audit logs weekly
4. **Backup Database**: Regular backups of SQLite database
5. **Limit Access**: Only create admin accounts for authorized personnel

### For Developers

1. **Never Log RTSP URLs**: Avoid logging camera credentials
2. **Input Validation**: Validate all user inputs
3. **SQL Injection**: Use parameterized queries (already implemented)
4. **XSS Prevention**: React automatically escapes content
5. **Dependency Scanning**: Regularly run `npm audit`

## Compliance Considerations

### Data Privacy

- **No Personal Data**: System does not store personal information of viewers
- **Admin Data**: Only admin usernames and hashed passwords stored
- **Audit Logs**: Contain IP addresses (consider GDPR implications)

### Video Retention

- MediaMTX does not record by default (live streaming only)
- If recording enabled, implement retention policies
- Ensure compliance with local surveillance laws

## Contact

For security concerns or to report vulnerabilities:
- Email: security@rafnet.com
- Emergency: Contact system administrator

---

**Last Updated**: 2025-12-23  
**Version**: 1.0
