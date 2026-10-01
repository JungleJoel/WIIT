# WIIT 
# Start

## 1. Prerequisites (install once)

### Node.js (LTS version)
- Download the **LTS** version from https://nodejs.org (npm is included)
- to check type in bash:
  node -v and
  npm -v

### Docker Desktop
- Download: https://www.docker.com/products/docker-desktop/
- **Windows:** WSL 2 must be enabled (the installer asks for it). Restart the computer after installing.
- **Mac with Apple Silicon (M1/M2/M3…):** In Docker Desktop, go to Settings → General and turn on
  "Use Rosetta for x86_64/amd64 emulation". The SQL Server image needs this.
- **Linux (Debian/Ubuntu):** Follow https://docs.docker.com/engine/install/
- Start Docker Desktop, then bash:
  docker --version and
  docker compose version

## 2. Install backend dependencies

 in bash:
cd backend and then
npm install


## 3. Start the database (SQL Server in Docker)

Make sure Docker Desktop is running, then from the `backend` folder:

in bash:
docker compose up -d


Check that the container is running: docker ps

The first start can take a minute while SQL Server boots.

P.S. to stop the database: `docker compose down`

## 4. Test the database connection
bash
node db-test.js

## 5. Start the backend
bash
node server.js






