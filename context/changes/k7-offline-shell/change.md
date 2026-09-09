# k7-offline-shell

```yaml
change_id: k7-offline-shell
memory_goal: b50027cf-438d-4a12-bf40-983fc53fc63e
epic: faza-0
slice: 7
mode: interactive
branch: change/k7-offline-shell
```

## What this delivers

The wall stays alive across a backend restart, and says so honestly.

- **Service worker**, hand-rolled, shell only. `/api` is never cached here.
- **Precache manifest** generated from what the build actually emitted.
- **Reconnect scrim** over the blurred stale grid, with attempt count, countdown
  and a determinate bar.

## Verified with a real browser

| | |
|---|---|
| Worker | `controller: true`, `activated`, cache `k7-shell-b810c824…`, 9 assets |
| Backend stopped, page reloaded | shell painted, **6 cards still on screen**, scrim visible |
| Scrim state | `próba 3`, `ponowna próba za 4 s`, `[!]` in warn |
| Recovery | re-renders without a reload, so the clock never stops |

## Two things this slice got wrong first

**The scrim covered a void.** The worker does not cache `/api`, so a reload during
an outage had no Layout and painted an empty deck — a scrim over blank space,
which is not the design. A Layout is not upstream data; it is the shape of the
screen, closer to the shell than to the weather. The last good one is now kept on
the device and repainted before the scrim goes over it. The data inside the cards
is still not cached, and the footer says so.

**Headless verification lied.** `--virtual-time-budget` does not drive service
worker installation: the test showed `ERR_CONNECTION_REFUSED` and looked exactly
like a broken worker, while the worker was registering and caching correctly.
Verifying one needs a real browser over the devtools protocol with real waits.

## Not done

- Not yet seen on the iPad. Safari 15's service worker implementation is the one
  that matters and is not the one that was tested.
- No update prompt: a new build takes over on the next navigation.
