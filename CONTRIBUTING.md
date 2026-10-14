# Contributing to PermForge

Thank you for your interest in contributing to **PermForge**! As an open-source project dedicated to the Salesforce ecosystem, community contributions are essential to making this tool robust and widely helpful.

---

## 🧭 Code of Conduct

All contributors are expected to uphold our [Code of Conduct](CODE_OF_CONDUCT.md). Please report unacceptable behavior to the maintainers.

---

## 🛠️ Development Setup

### Prerequisites

- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher
- **Git**

### Clone and Install

1. Fork the repository on GitHub: [https://github.com/visparashar/permforge](https://github.com/visparashar/permforge)
2. Clone your fork locally:
   ```bash
   git clone https://github.com/<your-username>/permforge.git
   cd permforge
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Build the project:
   ```bash
   npm run build
   ```
5. Test the local CLI:
   ```bash
   ./bin/run.js --help
   ```

---

## 🧪 Testing Guidelines

We use **Vitest** for unit and integration testing. Any new feature or bug fix must be accompanied by corresponding tests.

- Run all tests:
  ```bash
  npm test
  ```
- Run tests in watch mode during development:
  ```bash
  npm run test:watch
  ```
- Typecheck code:
  ```bash
  npm run lint
  ```

---

## 🌿 Git & Pull Request Workflow

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feat/add-record-type-clustering
   # or
   git checkout -b fix/preserve-empty-descriptions
   ```
2. Follow Conventional Commits:
   - `feat: ...` for new features
   - `fix: ...` for bug fixes
   - `docs: ...` for documentation changes
   - `test: ...` for test suite additions
   - `refactor: ...` for code refactoring
3. Ensure all tests and linting pass:
   ```bash
   npm run clean && npm run build && npm test && npm run lint
   ```
4. Push your branch and open a Pull Request against `main`.
5. Fill out the [Pull Request Template](.github/PULL_REQUEST_TEMPLATE.md) completely.

---

## 💡 Areas Where We Love Contributions

- Support for complex / custom XML tags (e.g. Einstein 1 / Agentforce permissions, Data Cloud permissions).
- Visual CLI improvements or interactive prompts.
- Additional decomposition strategies (e.g. frequency-based, permission clustering).
- Performance optimizations for orgs with 1,000+ custom objects.
