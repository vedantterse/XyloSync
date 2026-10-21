# Deploying XyloSync to Azure (xylosync.in)

One small VM runs everything: Caddy (HTTPS), the app, the worker, Redis and MinIO. GitHub Actions
tests and builds every push to `main`, pushes the image to GitHub's container registry (GHCR), then
logs into the VM over SSH and switches to the new version. If the new version isn't healthy it
switches back by itself. It works like your own Coolify, but nothing extra runs on the server: no
dashboard, no build tools and no webhook listener.

```
git push main ─▶ GitHub Actions: e2e tests ─▶ build image ─▶ ghcr.io/vedantterse/xylosync:sha-xxxxxxx
                                                                  │
                                         ssh ─▶ VM: deploy.sh pulls it, health-checks, rolls back on failure
```

You don't configure a GitHub webhook. The push itself starts the workflow, and the workflow
reaches the VM over SSH, so the VM needs no extra listener or open port.

## What it costs (Central India, pay as you go)

| Item | Choice | ≈ per month |
| --- | --- | --- |
| VM | **B2ats_v2** — 2 vCPU, 1 GiB RAM (+2 GB swap) | ₹374 |
| OS disk | 30 GiB Standard SSD (holds everything; rooms empty themselves after 8 h) | ~₹200 |
| Public IP | Standard, static | ~₹300 |
| Outbound data | First 100 GB/month free, then pay per GB | ₹0 for light use |

- **Free tier:** a new Azure free account covers B2ats_v2 (750 h/month) and SSD disks for 12 months.
- **Why B2ats_v2:** the whole stack uses about 190 MB at idle, and every service has a memory cap, so
  1 GiB plus swap is enough.
- **When to upgrade:** if you see memory pressure, resize to **B2als_v2** (4 GiB, ~₹1,494). Stop the
  VM, change the size, start it again; nothing else changes.
- **Pick the "a" sizes:** B2ats/B2als are AMD and cost about half of B2ts/B2ls for the same spec.
- **Watch outbound data:** it's the cost that grows with use, because every download leaves Azure.

Cheaper alternatives if you aren't tied to Azure:

- **Oracle Cloud "Always Free":** an Ampere ARM VM with up to 24 GB RAM at no cost. Set
  `platforms: linux/arm64` in the workflow.
- **Hetzner CX22:** 4 GB RAM for about €4.

The same files work on any Ubuntu VM.

## Step by step

### 1. Create the VM (Azure portal → Virtual machines → Create)

- **Region:** Central India (or the region closest to your users)
- **Image:** Ubuntu Server 24.04 LTS, x64
- **Size:** B2ats_v2
- **Authentication:** SSH public key; username `azureuser`. Download the key Azure creates, or paste
  your own.
- **Inbound ports:** SSH (22), HTTP (80), HTTPS (443)
- **Disks:** OS disk 30 GiB, *Standard SSD (LRS)*, "Delete with VM"
- **Monitoring:** boot diagnostics off (saves a storage account)

After it's created, make the IP static so DNS never breaks: VM → *Networking* → click the public
IP → *Configuration* → Assignment **Static** → Save. Note the IP address.

*(Optional, enables HTTP/3: in the VM's network security group, add an inbound rule allowing
**UDP 443**.)*

### 2. Point the domain at it

At your domain registrar, in the DNS settings for `xylosync.in`:

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| A | `@` | *the VM's IP* | 300 |
| A | `www` | *the VM's IP* | 300 |

Check it from your PC with `nslookup xylosync.in`; it should return the VM's IP before you deploy.
Caddy needs that in order to get the HTTPS certificate.

### 3. Prepare the server (once)

```bash
ssh azureuser@<VM-IP>
curl -fsSL https://raw.githubusercontent.com/vedantterse/XyloSync/main/deploy/setup-vm.sh | bash
exit                     # log out and back in so the docker group applies
```

The setup script installs Docker, adds a 2 GB swap file, turns on the firewall (22, 80 and 443
only), caps Docker's log sizes and creates `/opt/xylosync`.

### 4. Create the production settings on the server

```bash
ssh azureuser@<VM-IP>
cd /opt/xylosync
curl -fsSLo .env https://raw.githubusercontent.com/vedantterse/XyloSync/main/deploy/.env.production.example
openssl rand -hex 32     # run three times: APP_SECRET, WEBHOOK_SECRET, MINIO_ROOT_PASSWORD
nano .env                # fill in the secrets, ACME_EMAIL and your SMTP details
chmod 600 .env
```

**Email:** Azure blocks outgoing port 25, so the server can't send mail directly. Use any SMTP
relay on port 587 (Brevo, Resend, Mailgun, Amazon SES, or Gmail with an app password) and put its
host, user and password in `.env`. For your relay to accept `MAIL_FROM`, add the DNS records it
asks for (SPF/DKIM) to `xylosync.in`.

### 5. Give GitHub a deploy key

Create a dedicated key just for deployments (on your PC):

```bash
ssh-keygen -t ed25519 -f xylosync_deploy -C github-actions -N ""
ssh-copy-id -i xylosync_deploy.pub azureuser@<VM-IP>      # or paste the .pub into ~/.ssh/authorized_keys on the VM
ssh-keyscan -H <VM-IP>                                    # copy this output for VM_KNOWN_HOSTS
```

Then on GitHub → **XyloSync repo → Settings → Secrets and variables → Actions → New repository
secret**, add:

| Secret | Value |
| --- | --- |
| `VM_HOST` | the VM's IP |
| `VM_USER` | `azureuser` |
| `VM_SSH_KEY` | the whole contents of the `xylosync_deploy` file (the private key) |
| `VM_KNOWN_HOSTS` | the `ssh-keyscan` output (pins the server's identity) |

The deploy job uses a GitHub *environment* called `production` (it's created automatically on the
first run). Under **Settings → Environments → production** you can add yourself as a required
reviewer if you want to approve each deploy by hand.

Until `VM_HOST` and `VM_USER` are set, pushes still run the tests and build the image, and the
deploy step skips itself.

### 6. Deploy

Push to `main`, or open **Actions → Deploy → Run workflow**. Watch the run:
**End-to-end tests → Build and push image → Deploy to production**. The first deploy takes a few
minutes while the server downloads Caddy, Redis and MinIO and Caddy gets the certificate. Then
open **https://xylosync.in**.

## Rolling back

- **Automatic:** if a new version doesn't pass its health check within two minutes, `deploy.sh`
  puts the previous version back and the GitHub run fails, so you notice.
- **From GitHub (one click):** Actions → **Deploy** → *Run workflow* → enter an earlier tag such as
  `sha-1a2b3c4`. Every successful build is kept in GHCR, and the tag is the first 7 characters of
  the commit. This skips tests and building and just switches versions.
- **From the server (instant, no download):** the last 5 versions stay on the VM.

  ```bash
  ssh azureuser@<VM-IP>
  cd /opt/xylosync
  ./rollback.sh --list        # what was deployed and when
  ./rollback.sh               # back to the previous version
  ./rollback.sh sha-1a2b3c4   # or to a specific one
  ```

Rooms, files and chat live in Docker volumes, so deploys and rollbacks never touch them.

## Day to day

```bash
cd /opt/xylosync
docker compose -f docker-compose.prod.yml ps                     # health of every service
docker compose -f docker-compose.prod.yml logs -f app worker     # live logs
docker stats --no-stream                                         # memory per service
grep IMAGE_TAG .env                                              # which version is live
```

- **Storage console (MinIO):** it's only reachable through an SSH tunnel. Run
  `ssh -L 9001:127.0.0.1:9001 azureuser@<VM-IP>`, then open http://localhost:9001.
- **Change a setting:** edit `.env`, then `docker compose -f docker-compose.prod.yml up -d`.
- **Security updates:** Ubuntu installs them automatically (unattended-upgrades is on by default).
  Reboot once in a while with `sudo reboot`; every service starts again by itself.

## Files in this folder

| File | Where it runs | What it does |
| --- | --- | --- |
| `docker-compose.prod.yml` | VM | The production stack with memory caps; Caddy is the only thing on ports 80/443 |
| `Caddyfile` | VM | HTTPS for `xylosync.in`, `www` → apex redirect, streaming uploads, WebSockets |
| `deploy.sh` | VM | Pull a version, switch to it, health-check, auto-rollback, keep the last 5 |
| `rollback.sh` | VM | Go back to the previous (or a named) version |
| `setup-vm.sh` | VM, once | Docker, swap, firewall, log limits, `/opt/xylosync` |
| `.env.production.example` | VM | Template for `/opt/xylosync/.env` |
| `../.github/workflows/deploy.yml` | GitHub | Test → build → push → deploy, plus manual redeploys of any tag |
