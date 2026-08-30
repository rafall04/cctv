# Release channels & staged rollout

**Problem this solves:** every client box used to run `safe-deploy.sh`, which pulled the latest
`origin/main`. One regression pushed to `main` could therefore break **every** client the moment they
deployed. Release channels pin each box to a **tag** and let you roll a fix out **one box at a time**
(canary → fleet), so a bad release is contained instead of fleet-wide.

Runtime isolation between clients already exists (separate box / DB / process / secrets). Channels add
the missing **code**-level isolation.

## The pieces

| Piece | Where | Role |
|---|---|---|
| `DEPLOY_CHANNEL` | each box's `deployment/client.config.sh` (gitignored, local) | which channel THIS box tracks |
| `deployment/release-channels.json` | in the repo, on `main` | the ONE control point: which tag each channel deploys |
| release tags (`vX.Y.Z`) | git tags | immutable snapshots you deploy |
| `safe-deploy.sh` | each box | reads `DEPLOY_CHANNEL`, resolves it to a ref, deploys that ref |

`DEPLOY_CHANNEL` values:

- `main` — latest `origin/main` (the legacy behaviour; **unchanged**). Boxes with no `DEPLOY_CHANNEL`
  set also fall here, so **nothing changes until you opt a box in**.
- `stable` / `canary` — deploy the tag `release-channels.json` points that channel at (read from
  `origin/main`, so the box never decides its own version).
- `v1.4.0` or a commit SHA — pin this one box to exactly that tag/commit.

## Recommended setup

- Keep the dev/mothership box (or none) on `main`.
- Put **one** low-risk client on `canary`.
- Put every other client on `stable`.

Set it per box by editing `deployment/client.config.sh`:

```bash
# on the box
sed -i 's/^DEPLOY_CHANNEL=.*/DEPLOY_CHANNEL="stable"/' deployment/client.config.sh
```

(Existing boxes have no `DEPLOY_CHANNEL` line yet — add one: `echo 'DEPLOY_CHANNEL="stable"' >> deployment/client.config.sh`.)

## Cutting and rolling out a release

1. **Tag** a good commit on `main` (from your dev machine):

   ```bash
   git tag -a v1.1.0 -m "v1.1.0: <what changed>" origin/main
   git push origin v1.1.0
   ```

2. **Point canary at it** — edit `deployment/release-channels.json`, set `"canary": "v1.1.0"`, commit + push to `main`:

   ```bash
   git commit -am "release: canary -> v1.1.0" && git push
   ```

3. **Deploy the canary box** and verify (safe-deploy's health + stability gate, plus your own checks):

   ```bash
   # on the canary box
   bash deployment/safe-deploy.sh deploy   # it resolves canary -> v1.1.0 and pins to it
   ```

4. **Promote to stable** once canary is healthy — set `"stable": "v1.1.0"` in `release-channels.json`, commit + push:

   ```bash
   git commit -am "release: promote v1.1.0 to stable" && git push
   ```

5. **Deploy the fleet** — run `safe-deploy.sh deploy` on each `stable` box (any time; each pulls the
   stable tag). They can be deployed in waves.

A regression found on canary never reaches stable clients: you simply don't promote it, and fix
forward with a new tag.

## Rollback

- **One box:** `safe-deploy.sh` records the previous commit (`deployment/.last-deploy-rollback`); reset
  and redeploy, or set `DEPLOY_CHANNEL` to the previous tag and re-run.
- **The whole stable fleet:** point `"stable"` back at the previous good tag in `release-channels.json`,
  commit + push, and redeploy the boxes. One edit rolls the fleet back.

## Notes

- Channel deploys land in **detached HEAD** at the tag — correct for a deploy box (you never develop
  there; rollback still works). The `main` channel stays on the `main` branch exactly as before.
- Tags are immutable; **never** move a `vX.Y.Z` tag. To change what a channel ships, point the channel
  at a **different** tag in `release-channels.json`.
- `safe-deploy.sh` fails closed: an unknown channel, a missing manifest entry, or an unpushed tag
  aborts the deploy before any code changes.
