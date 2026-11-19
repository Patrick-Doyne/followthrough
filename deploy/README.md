# Running FollowThrough on one EC2 GPU instance

A lift-and-shift of the local stack (`LOCAL_DEV.md`) onto a single
GPU instance, so a phone on the internet can use the live page. Nothing here
is the eventual AWS design in `ARCHITECTURE.md` (KVS signaling, ECS tasks,
S3, a document store); it is the local stack behind a reverse proxy and a
tunnel, which is all a phone needs.

Two ways to get there, same result:

- **Terraform + Docker** (`terraform/`, `docker/`): one `terraform apply`
  creates the instance and it starts the whole stack in one container;
  `terraform destroy` removes everything so nothing costs money between
  sessions. The built image is kept in ECR, so a rebuilt instance starts
  in minutes rather than the 30–45 minutes the first image build takes.
- **By hand** (`ec2-setup.sh`, the systemd units): the same stack as
  services on the instance itself. Useful for poking at a single process.

## Terraform + Docker

```bash
# once: the SSH key the instance will trust
ssh-keygen -t ed25519 -N "" -f ~/.ssh/followthrough-ec2

cd deploy/terraform
terraform init
terraform apply                 # ~2 min, then the instance builds or pulls the image
terraform output                # ssh command, setup log, how to read the public address
terraform destroy               # when done; the ECR image stays for next time
```

Before the first apply, the account needs a GPU-instance quota: Service
Quotas → EC2 → "Running On-Demand G and VT instances" in the region, at
least 4 vCPUs for `g6e.xlarge` or `g5.xlarge`. New accounts start at 0 and
an increase can take hours, so request it first:

```bash
aws service-quotas request-service-quota-increase --service-code ec2 \
  --quota-code L-DB2E81BA --desired-value 8 --region us-east-1
```

What `apply` does: the latest **Deep Learning Base OSS Nvidia Driver GPU
AMI (Ubuntu 24.04)** (driver, Docker and the NVIDIA container toolkit
included), a `g6e.xlarge` by default (`-var instance_type=g5.xlarge` for
the cheaper A10G; a type or zone with no capacity answers
`InsufficientInstanceCapacity`, and `-var subnet_id=subnet-…` picks another
zone), a security group with SSH and the UDP range WebRTC uses,
an Elastic IP, an ECR repository and an instance role that may pull from
and push to it. The instance's first-boot script
(`terraform/user_data.sh`) clones the repository from GitHub at `repo_ref`
(default `main`), so the deploy files must be committed and pushed before
a fresh instance can use them, then pulls `followthrough:<image_tag>` from ECR or, when it is not
there, builds it from `docker/Dockerfile` and pushes it, then runs
`docker/compose.yaml`. Change `image_tag` after a code change to force a
rebuild.

Follow the first boot with the `setup_log` output's command. Once the
container is up it builds the three TensorRT engines for that GPU with
`trtexec` (a few minutes, kept in a volume), starts the six processes
under supervisord, and the tunnel's address is at
`/var/log/followthrough/public-origin` inside the container (the
`public_origin` output prints the command). The API waits for that
address before it starts, so CORS and upload URLs are right from the
first request.

Inside the container: `docker exec followthrough supervisorctl status`
(`compose.yaml` names the container),
logs under `/var/log/followthrough/`, the database and recordings in
named volumes (`followthrough-data`, `followthrough-storage`) that survive
`docker compose up --build` but not `terraform destroy`.

## By hand

```
phone ── https ──► Cloudflare quick tunnel ──► Caddy :80 ──┬── /api/v1/*  ──► Spring Boot :8082
                                                          ├── /relay     ──► signaling relay :8080
                                                          └── /*         ──► web app (node) :3000
phone ◄── WebRTC media/DataChannel (UDP, STUN) ──► follow_through_webrtc (connects to the relay on localhost)
```

One origin serves everything, so the web app needs no addresses baked in:
away from `localhost` it talks to its own origin (`src/services/http.ts`,
`src/config/streaming.ts`). The backend learns its public address through
STUN (`FT_STUN_URL`) and connects to the relay next to it (`FT_RELAY_HOST`).

## Instance

- Region `us-east-1`. AMI: **Deep Learning Base OSS Nvidia Driver GPU AMI
  (Ubuntu 24.04)**. Type `g6e.xlarge` (L40S) or `g5.xlarge` (A10G); check
  the "Running On-Demand G and VT instances" quota first. 150 GB gp3.
- Security group inbound: TCP 22 from your IP; **UDP 1024–65535 from
  anywhere** (WebRTC media; ICE picks random ports). No TCP 80/443 needed:
  the tunnel dials out.
- An Elastic IP, so stopping the instance overnight keeps the address.

## Setup

```bash
ssh -i ~/.ssh/<key>.pem ubuntu@<elastic-ip>
git clone https://github.com/Patrick-Doyne/followthrough.git ~/followthrough
bash ~/followthrough/deploy/ec2-setup.sh      # 60–90 min, rerunnable
sudo ~/followthrough/deploy/set-public-origin.sh
```

The setup script installs Node 22, Java 17, CUDA 13.3, TensorRT 11.2.1,
builds the KVS WebRTC C SDK, fetches the release assets, exports the three
TensorRT engines **on this GPU** (engines never move between machines),
builds the binaries, the web app (node-server preset) and the API jar,
installs Caddy, cloudflared and five systemd units, and starts them.

`set-public-origin.sh` reads the tunnel's `https://….trycloudflare.com`
address from the `ft-tunnel` journal, writes it to `/etc/followthrough/api.env`
as `FT_PUBLIC_ORIGIN` (CORS and the upload URLs the API hands out) and
restarts the API. The address changes every time the tunnel restarts, so
rerun it after a reboot.

## Use

Open the printed address on the phone in **Microsoft Edge**, sign in as the
seeded demo account (`patrick.doyne@followthrough.app` /
`followthrough-dev`), open **Live Training**, hold the phone upright and
start a session. The page asks for 720p at 60 fps. The line under the clock shows the phone's
encoder (implementation, size, rate, ms per frame, limitation); the
backend's `[PERF]` lines (`journalctl -u ft-backend -f`) show `stream_fps`,
decode and per-stage milliseconds.

## Verify from the development machine before touching a phone

`follow-through-pro-19/scripts/live-check.mjs` drives the Live page with a
fake camera from this machine against any origin and reports what was sent
and what came back:

```bash
cd follow-through-pro-19
BASE=https://<name>.trycloudflare.com node scripts/live-check.mjs /path/to/camera.mjpeg shot.png
```

It prints the sender's statistics (frames sent, size, rate, encoder) and
the number of telemetry messages received, and exits non-zero if either
is missing; `VIEWPORT=390x844` runs it at phone size. The same script
against `scripts/edge-proxy.mjs` (a local stand-in for Caddy and the
tunnel) checks this topology without an instance at all. Do not run it
while a phone session is up: the backend serves one viewer at a time.

## Operate

```bash
sudo systemctl status ft-relay ft-backend ft-api ft-web ft-tunnel caddy
journalctl -u ft-backend -f          # [KVS] ICE servers, engines ready, [PERF]
journalctl -u ft-tunnel --no-pager | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1
sudo systemctl restart ft-backend    # after a rebuild (cmake --build cpp/build --target follow_through_webrtc)
```

Units: `ft-relay` (node relay, :8080), `ft-backend` (`follow_through_webrtc`,
run from `cpp/build`, SIGINT to stop), `ft-api` (Spring Boot jar, :8082, H2
on disk under `springboot/local-data/`), `ft-web` (`node
.output/server/index.mjs`, :3000), `ft-tunnel` (cloudflared quick tunnel to
Caddy). Caddy's own unit reads `/etc/caddy/Caddyfile` (copied from
`deploy/Caddyfile`).

Stop the instance when not in use (the Elastic IP and disk persist); on the
next start every unit comes back, then rerun `set-public-origin.sh` for the
new tunnel address.

## Known limits of this setup

- The tunnel carries HTTP and WebSocket only; WebRTC media goes directly
  between the phone and the instance over UDP. If a carrier NAT blocks it,
  add a TURN server (`FT_TURN_URL`, `FT_TURN_USERNAME`, `FT_TURN_CREDENTIAL`
  in `ft-backend.service`; coturn on the same instance works).
- Over cellular the uplink carries about 1 Mbit/s cleanly. The sender's
  own rate control (`services/webrtc-live.ts`) shrinks the picture and
  keeps the frame rate, so the live preview works on a smaller picture
  than the recording.
- In the container the API runs the real offline pipeline
  (`followthrough.processing.engine=cpp` against the batch binary built in
  the image, `docker/start-api.sh`), so uploads and finished live sessions
  are analysed on the instance; the preparation script's ffmpeg comes from
  the web app's `npm ci`. The by-hand unit `systemd/ft-api.service` sets no
  engine and runs the stub processor (`BACKLOG.md`).
- Caddy sends `Cache-Control: no-cache` for the page and `immutable` for
  `/assets/*`, so a phone picks up a deploy on its next reload.
- A recording is stored under its real type (a recorder's
  `video/mp4;codecs=avc1` as `.mp4`); older `.bin` files are served by
  reading their header.
