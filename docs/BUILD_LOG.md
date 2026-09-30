# Build log

How Outpace was built: one Claude Code session with **Claude Opus 5.5** as the orchestrator and **Sonnet 5.5** subagents for well-scoped parallel tasks. The raw timestamped events and agent usage are in [`build-log/`](build-log).

## At a glance

| | |
| --- | --- |
| Wall clock, first prompt to a working local game | ~45 min (02:36 to 03:21 UTC, 2026-09-30) |
| Human input | 1 brief + 4 mid-build redirections |
| Orchestrator context used (Opus 5.5) | ~372k tokens* |
| Subagent tokens (2 × Sonnet 5.5) | 129,877 |
| Automated tests | 47 passing |
| Screenshots taken during visual QA | 38 |
| npm dependencies | 0 |

\* This is how much the harness's context counter went down. It is not billed tokens: billed input is higher, because every model call re-reads the context, discounted by prompt caching. The publish and deploy step came later and isn't counted here.

## Timeline (UTC)

| Time | What happened |
| --- | --- |
| 02:36 | Brief received. Plan: a zero-dependency Node server, a vanilla JS engine and UI, and Playwright visual QA. |
| 02:39 | A Sonnet 5.5 agent is sent to build the server, store, validation and tests from an exact spec, in parallel. |
| 02:40 | Backend agent done: 30/30 tests on its first run (2m 23s, 62.8k tokens). |
| 02:42 | Adaptive "tide" engine tuned over 3 simulation passes. |
| 02:49 | First UI; visual QA begins. |
| 02:53 | **Redirection 1:** "a runner like the dino game, with the Claude mascot, Claude-themed". A runner scene is added and the palette is rethemed. |
| 03:01 | **Redirection 2:** "more minimal, the whole page should be the landscape". Rebuilt as a full-screen world with the words set into the ground. |
| 03:06 | **Redirection 3:** "the wave can be much better". Rebuilt as a pixel-art Great Wave. |
| 03:10 | A Sonnet 5.5 security agent attacks an isolated instance (2m 38s, 67.1k tokens). Fixes applied. |
| 03:13 | **Redirection 4:** "space should jump, creatures come at you, different damage, double and triple jumps". The engine is rewritten, then feasibility and balance sims are run. |
| 03:20 | 47/47 tests passing, desktop and mobile play-throughs verified. |

## Subagents

| Agent | Model | Tokens | Tool calls | Duration | Result |
| --- | --- | --- | --- | --- | --- |
| Backend builder | Sonnet 5.5 | 62,750 | 9 | 2m 23s | Server, store, validation, 30 tests, all passing on the first run |
| Security QA | Sonnet 5.5 | 67,127 | 12 | 2m 38s | No XSS, path traversal, token forgery or prototype pollution. Three real weaknesses confirmed, then fixed. |

Both agents got closed specs with explicit files, hard boundaries ("never touch port 4173", "don't edit `public/`") and done criteria. Design and game feel stayed with the orchestrator, because that work needed the screenshot feedback loop.

## Iterations and bugs caught by testing

1. **Bug:** the balance sim showed every run stuck at level 1. The word index advanced twice per word.
2. **Balance:** runs lasted 6 to 10 minutes because golden words healed too often. Healing moved to rare heart words.
3. **Balance:** slow typists survived longest because levels were counted in words. Waves became time-based.
4. **Bug:** new difficulty took about a minute to reach the screen because of a 400-character look-ahead. Cut to 160.
5. **Bug:** CSS overrode the `hidden` attribute, so "Show more" showed on an empty board.
6. **Bug:** browsers kept stale JS and CSS for an hour. Switched to `no-cache` with ETags.
7. **Redirections 1 to 3:** runner scene, then the immersive layout, then the pixel Great Wave.
8. **Bug:** pressing Esc during the game-over delay popped the old results over the new run.
9. **Bug:** Sprint showed stomp points that it doesn't award.
10. **Security:** forged stats were accepted, for example wave 99 after a 4-second run. The level must now fit the run time, WPM is capped, and the elapsed check is tighter.
11. **Security:** Unicode lookalike names could take several leaderboard slots. Added NFKC identity normalization, plus `Retry-After` on 429.
12. **Redirection 4:** jumping, five creatures, half-heart health, double and triple jumps.
13. **Balance:** a brute-force search over jump timings showed the Code Stack was nearly unbeatable (0 of 303 timings) and the Giant had only 4 of 909. Retuned until each creature had a timing window of about 400 to 650ms.

## Final balance simulation

Bots type at a set speed with noise, and jump with ±70ms reaction jitter and an 8% miss rate:

```
 25 wpm: ~110s  wave 6  score 10,960
 45 wpm: ~119s  wave 6  score 15,758
 70 wpm: ~131s  wave 7  score 30,162
100 wpm: ~131s  wave 7  score 47,220
130 wpm: ~126s  wave 7  score 50,919
```

Run length is about the same at every skill level, so the difficulty adapts fairly, and score rises steadily with skill.
