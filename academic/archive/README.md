# docs/archive — do not read these as current

Every file in this directory describes an **earlier version of ShramSetu that no
longer exists**. They are kept only as a record of what the project was and what
was wrong with it.

**The stack described here (FastAPI + SQLModel + SQLite, Python backend) is not
the stack this project runs on.** The current system is:

| Layer | Actual stack |
|---|---|
| Frontend | React 18 + TypeScript + Vite (PWA) |
| API server | Node.js 22 + Express 4 + Mongoose 8 |
| Database | MongoDB |
| AI service | Python 3.10 + FastAPI (separate service, port 8100) |

Because these documents are stale, treat **everything specific in them as wrong**:

- file paths and module names
- test counts
- ports and commands
- credential examples
- claims that a feature is complete

They are archived precisely because they describe problems that have since been
fixed — reading them as a statement of the present would be a false picture of
the project.

## For the current, true description

| Question | Read |
|---|---|
| What runs where, and on which port | [../ARCHITECTURE.md](../ARCHITECTURE.md) |
| How to run it | [../../README.md](../../README.md), [../../DEMO.md](../../DEMO.md) |
| Security posture and known limits | [../SECURITY.md](../SECURITY.md) |
| How retrieval is evaluated | [../../ai-service/eval/ANALYSIS.md](../../ai-service/eval/ANALYSIS.md) |

The filenames below are prefixed `ARCHIVED_` so the status is visible in a file
listing, not only when the file is opened.