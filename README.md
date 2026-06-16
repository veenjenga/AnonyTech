# AnonyTech

**A coercion-resistant, cryptographically verifiable e-voting platform.**

AnonyTech lets an organization (originally designed for student/university elections) run an election where every ballot is anonymous, mathematically verifiable, and protected against a voter being forced to vote a certain way — without ever trusting a single server with both a voter's identity *and* their choice.

> Original UI design: [Figma — Anonytech](https://www.figma.com/design/N3AfR4wiiLIV7k6aETfyab/Anonytech)

## Features

- **Coercion resistance (Mode A / Mode B).** A coerced voter can cast a indistinguishable "decoy" ballot (Mode A) that looks identical to a real one on the public bulletin board, then return later and cast their real, counted ballot (Mode B).
- **End-to-end cryptographic verifiability.** RSA blind signatures issue anonymous voting credentials, Paillier homomorphic encryption keeps individual votes secret while still being countable, and a Fiat–Shamir disjunctive zero-knowledge proof lets the server confirm "this ciphertext is a 0 or a 1" without ever learning which.
- **Single decryption event.** The tally is produced by homomorphically summing every ballot into one ciphertext and decrypting it exactly once — individual ballots are never decrypted.
- **Pluggable tallying methods.** Plurality, Borda Count, Single Transferable Vote, and Liquid Democracy are implemented as interchangeable strategy plugins. Switching the active method is a one-line config change, no other code touched.
- **Graceful Degradation Protocol.** A 5-stage failure pipeline (detect → classify → recover → verify integrity → resolve) handles power loss, network partition, storage corruption, and client disconnects using WAL replay and a Redis write-ahead log — no cryptography required to verify the recovery.
- **Bilingual UI.** English and Kiswahili, switchable at any time.
- **Full admin console.** Election lifecycle control, departments/roles/candidates management, voter management, live results, audit log export, and a "Security" tab that lets an admin simulate and recover from each of the four failure types.
- **Public bulletin board & ballot verification.** Anyone can look up their ballot's token hash and confirm it was received, proof-verified, and included in the tally.

## Architecture

The system is four independently-runnable services plus a shared Postgres database:

```mermaid
graph TD
    FE["Frontend<br/>React + Vite (browser)"]
    GW["API Gateway<br/>server.js (Node/Express) :5000"]
    CRYPTO["Crypto Service<br/>FastAPI (Python) :8001"]
    PLUGIN["Plugin Engine<br/>FastAPI (Python) :8000"]
    PG[("PostgreSQL<br/>shared system of record")]
    SQLITE[("SQLite<br/>election.db<br/>(crypto bookkeeping)")]
    REDIS[("Redis<br/>AOF write-ahead cache")]

    FE -->|REST/JSON| GW
    GW -->|voters, config, ballots, audit| PG
    GW -->|proxy /api/crypto/*| CRYPTO
    GW -->|proxy /api/plugin/*, /api/recovery/*| PLUGIN
    CRYPTO --> PG
    CRYPTO --> SQLITE
    PLUGIN --> PG
    PLUGIN --> REDIS
```

The frontend never talks to the Crypto Service or Plugin Engine directly — everything goes through the Node gateway, so admin actions can be audited and CORS stays simple.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript, Vite, React Router, Motion (Framer Motion), Tailwind CSS, lucide-react, Recharts, react-i18next |
| API Gateway | Node.js, Express, `pg` (node-postgres), bcryptjs, nodemailer (production OTP email) |
| Crypto Service | Python, FastAPI, custom Paillier homomorphic encryption + RSA blind signatures + ZKP, psycopg2 |
| Plugin Engine | Python, FastAPI, asyncpg, redis-py (asyncio) |
| Data | PostgreSQL (primary store), SQLite (crypto-layer bookkeeping), Redis (disaster-recovery AOF cache) |

## Repository layout

Inferred from the Python import paths used throughout the codebase (`app.core.plugin_interface`, `election_server.election_server`, etc.):

```
.
├── frontend/                       # React + Vite app
│   └── src/
│       ├── components/             # LoginPage, BallotPage, AdminDashboard, ...
│       └── utils/
│           └── dataStore.ts        # localStorage/sessionStorage helpers (coercion mode, theme)
│
├── server.js                       # API Gateway — Express, Postgres, proxies to the two Python services
│
├── crypto-service/                 # Crypto Service (FastAPI app, port 8001)
│   ├── crypto_api.py
│   ├── registration_server/registration_server.py
│   ├── ballot_server/ballot_server.py
│   ├── election_server/election_server.py
│   ├── tally_server/tally_server.py
│   ├── voter_client/voter_client.py
│   └── shared/
│       ├── paillier.py             # Paillier keypair / EncryptedNumber implementation
│       └── database.py             # SQLite helper for tally_server
│
└── plugin-engine/                  # Plugin Engine (FastAPI app, port 8000)
    └── app/
        ├── main.py                 # FastAPI app: /health, /plugin/*, /election/*, /recovery/*
        ├── core/
        │   ├── plugin_interface.py
        │   ├── plugin_loader.py
        │   └── graceful_degradation.py
        └── plugins/
            ├── plurality_plugin.py
            ├── borda_plugin.py
            ├── stv_plugin.py
            └── liquid_plugin.py
```

If your actual folder names differ, adjust the `sys.path.insert` calls at the top of the Python files (or run each service from the directory those imports expect).

## Prerequisites

Install these before doing anything else:

| Tool | Minimum version | Why |
|---|---|---|
| [Node.js](https://nodejs.org/) | 18.x | `server.js` uses the built-in global `fetch` (stable since Node 18) |
| [Python](https://www.python.org/downloads/) | 3.10 | The codebase uses `str \| None` union-type syntax, which requires 3.10+ |
| [PostgreSQL](https://www.postgresql.org/download/) | 13+ | Shared system-of-record for voters, ballots, config, audit log, etc. |
| [Redis](https://redis.io/download/) | 6+ | Write-ahead AOF cache used by the Plugin Engine's disaster-recovery protocol |
| npm | bundled with Node | Frontend and gateway package management |
| pip / venv | bundled with Python | Python dependency management |

## Installation

### 1. Clone the repo

```bash
git clone https://github.com/<your-username>/anonytech.git
cd anonytech
```

### 2. Create the database

```bash
createdb evoting_system
```

Every table (`voters`, `departments`, `roles`, `candidates`, `ballots`, `election_config`, `audit_log`, `tally_results`, `bulletin_board`, `crypto_issued_tokens`, `plugin_ballots`, `recovery_events`, `voter_journey`, `support_tickets`, `feedback`) is created automatically on first run by the relevant service — there is no manual migration step.

### 3. API Gateway (`server.js`)

```bash
npm install express cors bcryptjs pg dotenv nodemailer
```

Create a `.env` file next to `server.js`:

```env
PORT=5000
NODE_ENV=development

DB_USER=postgres
DB_PASSWORD=your_postgres_password
DB_HOST=localhost
DB_PORT=5432
DB_NAME=evoting_system

CRYPTO_API_URL=http://localhost:8001
PLUGIN_API_URL=http://localhost:8000

# Only required when NODE_ENV=production — in development, OTPs are
# logged to the console and returned in the API response instead.
EMAIL_HOST=
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=
EMAIL_PASS=
EMAIL_FROM=
```

Run it:

```bash
node server.js
```

### 4. Crypto Service (`crypto_api.py`)

```bash
cd crypto-service
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install fastapi uvicorn pydantic psycopg2-binary cryptography python-dotenv
```

Create a `.env` file in `crypto-service/`:

```env
CRYPTO_PORT=8001
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_postgres_password
DB_NAME=evoting_system
```

Run it:

```bash
python crypto_api.py
```

RSA keys (`reg_private.pem` / `reg_public.pem`) and the Paillier keypair (`paillier_public.json` / `paillier_private.json`) are generated automatically into a `keys/` directory the first time the service starts.

### 5. Plugin Engine (`app/main.py`)

```bash
cd plugin-engine
python -m venv venv
source venv/bin/activate
pip install fastapi uvicorn pydantic asyncpg redis python-dotenv
```

Create a `.env` file in `plugin-engine/`:

```env
PORT=8000
DATABASE_URL=postgresql://postgres:your_postgres_password@localhost:5432/evoting_system
REDIS_URL=redis://localhost:6379
ACTIVE_METHOD=plurality
```

Run it:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 6. Frontend

```bash
cd frontend
npm install
```

Create a `.env` file in `frontend/`:

```env
VITE_API_URL=http://localhost:5000
VITE_PLUGIN_API_URL=http://localhost:8000
```

Run it:

```bash
npm run dev
```

### Start-up order

Postgres and Redis should already be running, then start: Crypto Service (8001) → Plugin Engine (8000) → API Gateway (5000) → Frontend (Vite dev server, usually 5173). The gateway will still boot if the Python services aren't up yet, but voting and tallying will return 502s until they are.

## Voting methods

| Method | Ballot type | Notes |
|---|---|---|
| Plurality | Pick one candidate | First-past-the-post |
| Borda Count | Rank all candidates | Rank 1 = N−1 points, last rank = 0 points |
| Single Transferable Vote | Rank candidates (full or partial) | Droop quota, surplus transfer, lowest-candidate elimination per round |
| Liquid Democracy | Cast directly, or delegate to a proxy | Transitive delegation (capped chain length), with an autonomy/concentration warning if one delegate ends up controlling >30% of resolved votes |

Switch the active method from the admin console's "Voting Methods" tab, or by changing `ACTIVE_METHOD` and calling `POST /api/plugin/switch` — no restart required.

## Security model, in brief

A voter authenticates once via email + OTP and receives an RSA blind signature — the Registration Server signs a blinded token without ever seeing the real token, so the resulting credential can't be linked back to that authentication event. The voter encrypts their choice with the election's Paillier public key and attaches a zero-knowledge proof that the ciphertext encrypts 0 or 1 (never anything else), without revealing which. The Ballot Server verifies the signature and the proof, then stores the ballot with no voter identifier of any kind. At tally time, every real ballot's ciphertext is homomorphically combined into one value, which is decrypted exactly once.

This is a teaching/demonstration implementation of these primitives rather than an audited production cryptographic library — review the `shared/paillier.py` and ZKP code carefully (or swap in a vetted library) before using it for a real, high-stakes election.

## License
