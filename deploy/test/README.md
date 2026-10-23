# Test server

One EC2 instance in eu-north-1 runs the whole server side as Docker containers: the public
web app, the admin console, both APIs, the notification worker, Postgres + PostGIS, Valkey,
ElasticMQ (the SQS stand-in), and Garage (the S3 stand-in). Caddy gets a Let's Encrypt
certificate and routes five hostnames.

This is the testing box. Dev, staging, and production stay on the CDK stacks in `infra/`
(Fargate, RDS, real SQS). Do not put production data here. Admin is on the public internet,
behind the bootstrap password and TOTP, with no IP allowlist. Publisher registration returns
the verification token in the JSON until email is wired (`INCLUDE_VERIFICATION_TOKEN`).

The phone app is not a container. A TestFlight or internal build talks to this API when
`EXPO_PUBLIC_API_URL` is `https://api.<domain>/v1` and `EXPO_PUBLIC_WEB_URL` is
`https://app.<domain>`.

## Size

Use **t4g.medium** (2 vCPU, 4 GiB) or larger, Ubuntu 24.04 arm64, a 30 GiB gp3 volume, and an
Elastic IP. A t4g.small (2 GiB) runs out of memory while Next.js builds. Add 4 GiB of swap
before the first build. Build on the instance so the images match its CPU. An image built on
an Intel machine will not start on a t4g instance.

Nothing except 22 (your IP), 80, 443, and 5432 (your IP) should be open. Postgres is
published on 5432 so you can connect from that address. Valkey, ElasticMQ, and Garage stay
on the Docker network. Docker presents the bridge address to Postgres, so the security
group is what limits who can reach it. Connect as `events` to database `events` with
`POSTGRES_PASSWORD`.

## DNS

One wildcard record is enough. If the name is `test.example.com`:

| Hostname                     | Process      |
| ---------------------------- | ------------ |
| `app.test.example.com`       | Web          |
| `api.test.example.com`       | Public API   |
| `admin.test.example.com`     | Admin        |
| `admin-api.test.example.com` | Admin API    |
| `assets.test.example.com`    | Event images |

`DOMAIN=test.example.com` in `.env`. Point `test.example.com` and `*.test.example.com` at the
Elastic IP, and wait until they resolve, before starting Caddy. Port 80 has to be reachable
for the certificate.

## First boot

On the instance, as a user in the `docker` group, with Docker Engine and the Compose plugin
installed:

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

git clone <this repo>
cd evnt
cp deploy/test/.env.example deploy/test/.env
# fill DOMAIN, ACME_EMAIL, and the generated secrets
sh deploy/test/up.sh
```

Generate the secrets with the commands at the top of `.env.example`. Keep the passwords hex.
`up.sh` writes `garage.toml` from the template, migrates, allows anonymous image reads, then
builds and starts the stack. The first build is the slow part.

Changing `DOMAIN` changes the URLs baked into the web and admin images. Run `up.sh` again
after that change.

## Imports

Imports are off until you ask. A one-shot run:

```bash
docker compose --profile manual run --rm --no-deps \
  -e SOURCE_SLUG=visit-soderhamn data-workers
```

A loop every six hours (import, then event scan, then publisher scan):

```bash
docker compose --profile ingest up -d
```

Set `CHAT_PROVIDER` and a key in `.env` before expecting scans to finish. The instance does
not run Ollama (`OLLAMA_DISABLED` defaults to 1). `ANTHROPIC_API_KEY` on the API is what
user tips call. `PUSH_DRY_RUN` defaults to 1, so the worker records deliveries and does not
call Expo.

Run the commands from `deploy/test`, or pass `-f deploy/test/docker-compose.yml` from the
repo root. `up.sh` already does the first.

## Updates

```bash
git pull
sh deploy/test/up.sh
```

Postgres data lives in the `pgdata` volume and survives a recreate. `up.sh` runs migrations
again.

Logs: `docker compose logs -f api` (and `web`, `admin`, `admin-api`, `worker`, `caddy`).
