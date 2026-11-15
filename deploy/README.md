# Deploying XyloSync to Oracle Cloud, free (xylosync.in)

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

## What it costs: nothing (Oracle Cloud "Always Free")

| Item | Always Free allowance | XyloSync uses |
| --- | --- | --- |
| VM | `VM.Standard.E2.1.Micro` (AMD): 1 GB RAM, up to two VMs; or Ampere A1 (ARM) up to 2 OCPU / 12 GB | one E2.1.Micro (+2 GB swap) |
| Disk | 200 GB of boot and block volumes | 50 GB boot volume |
| Outbound data | 10 TB per month | downloads and pages |
| Public IP | one per VM | yes |

- **Which VM:** the Ampere A1 is far bigger, but Mumbai is often *out of host capacity* for it.
  The E2.1.Micro is usually available, and the memory caps are sized for it. If you get an A1
  later, nothing else changes: GitHub Actions builds the app for both `linux/amd64` and
  `linux/arm64`, and Caddy, Redis and MinIO all publish ARM images. Just raise the caps.
- **Home region matters:** Always Free Ampere VMs exist only in the home region you pick at
  sign-up, and that can't be changed later. If creating the VM says *out of host capacity*, try
  another availability domain or try again later.
- **Idle reclamation:** Oracle may reclaim an Always Free VM that is idle for 7 days (CPU,
  network *and* memory all under 20%). A quiet site can look idle. Upgrading the account to
  **Pay As You Go** keeps Always Free resources free; check Oracle's billing page before you
  rely on that. Set a budget alert of ₹0/$1 so you'd hear about any charge.
- **Memory caps:** every service has a cap that fits a 1 GB VM plus swap, so one can't starve the others.

The same files work on any Ubuntu VM (x86 or ARM).

## Step by step

### 1. Create the VM (Oracle Cloud console → Compute → Instances → Create instance)

- **Name:** `xylosync`
- **Image:** *Change image* → **Canonical Ubuntu 24.04** (the aarch64 build is picked for you
  once the shape is Ampere)
- **Shape:** *Change shape* → **Specialty and previous generation** → `VM.Standard.E2.1.Micro`
  (it should say "Always Free-eligible"). If Ampere capacity is available, `VM.Standard.A1.Flex`
  with 1-2 OCPUs is better.
- **Networking:** first create the network with **Networking → Virtual cloud networks → Start VCN
  Wizard → Create VCN with Internet Connectivity**. Then pick that VCN and its **public subnet**
  here and switch on **Automatically assign public IPv4 address**. (Creating the network inside
  this form leaves the public IP switch greyed out.)
- **SSH keys:** *Paste public keys* → paste the contents of your `.pub` deploy key (see step 5)
- **Boot volume:** the default 50 GB is plenty

Click **Create** and wait until it says *Running*. Note the **Public IP address** on the instance
page. The username is `ubuntu`.

*(Optional, keeps the same IP even if you recreate the VM: Networking → IP management →
Reserved public IPs → reserve one, then attach it to the instance's VNIC.)*

### 2. Open ports 80 and 443 in Oracle's network

Oracle blocks everything except SSH by default, in two places. The setup script (step 4) handles
the firewall inside the server; this is the one in the cloud network:

Instance page → **Subnet** link → **Security Lists** → *Default Security List* → **Add Ingress
Rules**, and add:

| Source CIDR | IP protocol | Destination port |
| --- | --- | --- |
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |
| `0.0.0.0/0` | UDP | `443` (optional, enables HTTP/3) |

### 3. Point the domain at it

In Cloudflare's DNS for `xylosync.in`, edit both records to the new IP and keep them **DNS only**
(grey cloud). Caddy gets the HTTPS certificate itself, and that needs to reach the server directly.

| Type | Name | Value | Proxy |
| --- | --- | --- | --- |
| A | `@` | *the VM's IP* | DNS only |
| A | `www` | *the VM's IP* | DNS only |

Check it from your PC with `nslookup xylosync.in`; it should return the new IP before you deploy.

### 4. Prepare the server (once)

```bash
ssh -i ~/.ssh/xylosync_oracle ubuntu@<VM-IP>
curl -fsSL https://raw.githubusercontent.com/vedantterse/XyloSync/main/deploy/setup-vm.sh | bash
exit                     # log out and back in so the docker group applies
```

The setup script installs Docker, opens ports 80 and 443 in the server's own firewall (Oracle's
Ubuntu images reject them by default), caps Docker's log sizes and creates `/opt/xylosync`.
Swap is only added on machines with less than 2 GB of RAM.

### 5. Create the production settings on the server

```bash
ssh -i ~/.ssh/xylosync_oracle ubuntu@<VM-IP>
cd /opt/xylosync
curl -fsSLo .env https://raw.githubusercontent.com/vedantterse/XyloSync/main/deploy/.env.production.example
openssl rand -hex 32     # run three times: APP_SECRET, WEBHOOK_SECRET, MINIO_ROOT_PASSWORD
nano .env                # fill in the secrets and your SMTP details
chmod 600 .env
```

**Email:** cloud servers block outgoing port 25, so use an SMTP relay on port 587. XyloSync uses
SMTP2GO (`mail.smtp2go.com`). Put its user and password in `.env`, and keep `MAIL_FROM` on the
verified domain, for example `XyloSync <no-reply@xylosync.in>`.

### 6. Give GitHub the deploy key

Create a dedicated key just for deployments (on your PC). Its `.pub` half is what you pasted into
the VM in step 1:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/xylosync_oracle -C github-actions -N ""
ssh-keyscan -H <VM-IP>                                    # copy this output for VM_KNOWN_HOSTS
```

Then on GitHub → **XyloSync repo → Settings → Secrets and variables → Actions**, set (or update):

| Secret | Value |
| --- | --- |
| `VM_HOST` | the VM's IP |
| `VM_USER` | `ubuntu` |
| `VM_SSH_KEY` | the whole contents of `~/.ssh/xylosync_oracle` (the private key) |
| `VM_KNOWN_HOSTS` | the `ssh-keyscan` output (pins the server's identity) |

Or from a terminal with the GitHub CLI:

```bash
gh secret set VM_HOST --body "<VM-IP>"
gh secret set VM_USER --body "ubuntu"
gh secret set VM_SSH_KEY < ~/.ssh/xylosync_oracle
ssh-keyscan -H <VM-IP> | gh secret set VM_KNOWN_HOSTS
```

The deploy job uses a GitHub *environment* called `production`. Under **Settings → Environments →
production** you can add yourself as a required reviewer if you want to approve each deploy by hand.

Until `VM_HOST` and `VM_USER` are set, pushes still run the tests and build the image, and the
deploy step skips itself.

### 7. Deploy

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
  ssh -i ~/.ssh/xylosync_oracle ubuntu@<VM-IP>
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
  `ssh -i ~/.ssh/xylosync_oracle -L 9001:127.0.0.1:9001 ubuntu@<VM-IP>`, then open http://localhost:9001.
- **Change a setting:** edit `.env`, then `docker compose -f docker-compose.prod.yml up -d`.
- **Security updates:** Ubuntu installs them automatically (unattended-upgrades is on by default).
  Reboot once in a while with `sudo reboot`; every service starts again by itself.

## Files in this folder

| File | Where it runs | What it does |
| --- | --- | --- |
| `docker-compose.prod.yml` | VM | The production stack with memory caps for a 1 GB VM; Caddy is the only thing on ports 80/443 |
| `Caddyfile` | VM | HTTPS for `xylosync.in`, `www` → apex redirect, streaming uploads, WebSockets |
| `deploy.sh` | VM | Pull a version, switch to it, health-check, auto-rollback, keep the last 5 |
| `rollback.sh` | VM | Go back to the previous (or a named) version |
| `setup-vm.sh` | VM, once | Docker, firewall (Oracle iptables or ufw), swap on small VMs, log limits, `/opt/xylosync` |
| `.env.production.example` | VM | Template for `/opt/xylosync/.env` |
| `../.github/workflows/deploy.yml` | GitHub | Test → build → push → deploy, plus manual redeploys of any tag |
