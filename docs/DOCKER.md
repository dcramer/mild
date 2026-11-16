# Docker

The image keeps its home directory in the `sift-data` volume, which must stay writable: refresh tokens rotate.

```bash
docker compose -f docker/compose.yaml build
```

```bash
docker compose -f docker/compose.yaml run --rm -it sift init
```

The container cannot write the encryption key anywhere but the volume, so `init` prints it: put it in `docker/.env` as `SIFT_KEY=…`, where compose passes it in, and run `init` again. For the model step choose the device-code login.

```bash
docker compose -f docker/compose.yaml up
```

The dashboard is then at http://localhost:8787, on this machine only. [docker/compose.yaml](../docker/compose.yaml) says how to publish it to other devices.

Not yet tried end to end. `init` inside the container works out the dashboard's address from the container, not the host, so the addresses it prints and the redirect addresses it gives for the Google client may be wrong there. See [TODO.md](../TODO.md).
