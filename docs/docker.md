# Docker

The image keeps its home directory in the `sift-data` volume, which must stay writable: refresh tokens rotate.

```bash
docker compose -f docker/compose.yaml build
```

```bash
docker compose -f docker/compose.yaml run --rm -it sift init
```

The container cannot write the encryption key anywhere but the volume, so `init` prints it: put it in `docker/.env` as `SIFT_KEY=…`, where compose passes it in, and run `init` again. The model is connected later, on the dashboard's setting-up page.

```bash
docker compose -f docker/compose.yaml up
```

The dashboard is then at http://localhost:8787, on this machine only. [docker/compose.yaml](../docker/compose.yaml) says how to publish it to other devices.

Not yet tried end to end. `init` inside the container works out the dashboard's address from the container, not the host, so the addresses it prints and the redirect addresses it gives for the Google client may be wrong there. See [TODO.md](../TODO.md).

## The image

Next.js builds the app as a standalone server (`output: 'standalone'`, `next.config.js`): its bundles, and only the files of the packages they load. Beside it are the command line's sources and the packages they load (`docker/cli-modules.ts` lists them in the build), so the image holds no build tools, no Next.js compiler and no development packages: 486 MB on disk and 100 MB to pull, where it was 1.33 GB and 261 MB. The container runs `sift run`, which readies the database and starts that server.

```bash
sh docker/smoke.sh
```

builds the image, runs it as `compose.yaml` does (read-only, no capabilities, a fresh volume) and checks that it answers `/api/session` and stops cleanly. It is not part of `pnpm check`.

