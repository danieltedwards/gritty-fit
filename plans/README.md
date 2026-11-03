# Plans

Each training plan is one JSON file in this folder, listed in `index.json`. The app shows every
plan in `index.json` under **Training → Choose a plan**. (When coach accounts arrive, plans will be
written in the app and stored online; this file format stays the same.)

## Adding a plan
1. Copy `pbbsw-phase-1.json` to a new file and edit it.
2. Add an entry for it in `index.json` (`id`, `file`, `name`, `phase`, `weeks`, `daysPerWeek`, `tags`, `summary`).

## Format (schema 1)
| Field | Meaning |
| --- | --- |
| `id` | Unique, never change it once clients use the plan (their history links to it) |
| `weeks`, `cycleWeeks` | Program length; `cycleWeeks` repeats the week guide (e.g. a 6-week block in a 12-week phase) |
| `weekGuide[]` | `{weeks:[1,2], label, effort, note, deload?}`; shown on the Training card and in workouts |
| `warmups{}` | Named warm-ups (`items: [{name, dose}]`) that days reference with `"warmup": "lower"` |
| `cardio` | `{perWeek:[3,4], minutes:[20,40], options:[...]}`; weekly cardio target |
| `days[]` | `{id, label, name, focus?, warmup?, optional?, freeform?, suggestions?, blocks[]}` |
| `blocks[]` | `{type: "single" \| "superset", name?, note?, rest?, exercises[]}`; superset `rest` starts after the last exercise of a round |
| `exercises[]` | `{id, name, sets, reps, role, tempo?, rest?, each?, effort?, notes?, bodyweight?}` |
| `role` | `main`, `accessory`, `isolation` or `core`; drives progression hints (double progression from the rep range) |
| `schedule[]` | Optional, for plans that change week to week: `[{weeks:[1,2], days:[...]}]`. The client sees the days for their current week; `days` should still hold week 1 (the template older app versions use). Keep day `id`s (d1, d2…) and exercise `id`s the same across weeks so "last time" numbers carry over |
| `days[].instructions` | Optional free text shown on the day (conditioning options, intervals, recovery work), one paragraph per line |
| `progression.kettlebell` | `true` for kettlebell plans: hints say to add reps, slow the tempo, cut rest, then move up a bell size instead of adding 5–10 lb |
| `sections[]` | Coaching text shown in the plan guide: `{title, body: [{p}, {ul:[...]}, {table:{head, rows}}]}` |

Exercise `id`s must be unique within a plan and should stay stable: a client's "last time" numbers
and PRs follow the id.
