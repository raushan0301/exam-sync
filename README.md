# Exam Sync

Welcome to the Exam Sync repository! This project is structured as a monorepo containing various applications and packages.

## Project Structure

- `apps/` - Contains the main applications (e.g., API, Web frontend).
- `packages/` - Shared libraries and modules (e.g., Database, UI components).
- `docs/` - Project documentation.
- `infra/` - Infrastructure and deployment configurations.
- `scripts/` - Utility scripts for development and operations.
- `workers/` - Background processing workers.

## Getting Started

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Environment Variables:**
   Copy the `.env.example` file to create your own `.env` configuration file:
   ```bash
   cp .env.example .env
   ```
   Fill in the required environment variables.

3. **Running the Project:**
   Please refer to the `package.json` scripts for specific commands to run the API, Web, or workers locally.

## License

This project is licensed under the MIT License.
