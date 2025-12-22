# Release v0.1.0

**Release Date:** 2025-12-22

---

## Summary

This release includes:
- ✨ 7 new feature(s)
- 🐛 28 bug fix(es)
- ♻️  17 refactor(s)
- 📚 10 documentation update(s)
- 🧪 6 test improvement(s)

---

## Changes

### ✨ Features

- Add focus management, loading indicators, error recovery, and event system (`a0c373d`)
- Add debug logging functionality and suppress MuPDF warnings based on config (`6105181`)
- Add certificate conversion utility (`94ad98c`)
- Add NSS database certificate support (`8cdfde8`)
- Add certificate store and token library management (`0bd0aae`)
- Add CLI and other fixes (`529c21c`)
- Migrate frontend to Tailwind CSS, refactor theme management, and add new signature and zoom features. (`1ad505a`)

### 🐛 Bug Fixes

- Adjustment fix alignment (`35bb624`)
- Udpate readme and docs with support (`3e88715`)
- Improve thumbnails loading (`81f92d7`)
- Left sidebar thumbnails were not showing up (`4982790`)
- Naming fixes (`cd28c61`)
- Update README.md (`18d567e`)
- Update repo (`92ab341`)
- Remove comments (`53e19a7`)
- Resolve memory leaks in event listeners and page cache cleanup (`a12eaa5`)
- Add CSP headers, input validation, and coordinate validation (`c26b36a`)
- Update builds (`845322a`)
- Add comprehensive position validation for signature placement (`e3fb7ec`)
- Improve security and reliability in signature and PDF services (`a5d90f8`)
- Correct logic for initializing sidebar states in createPDFTab function (`2e3427e`)
- Remove build-static.sh from repository and update .gitignore (`c31cf9c`)
- Initialize PDF service with nil context in command handlers (`0797da7`)
- Preselect first certificate in the list for signing (`2605d29`)
- Correct method name for verifying PDF signatures (`6bc728b`)
- Remove unused dependencies (`b996cbb`)
- Handle wrapped errors in config loading (`18d1776`)
- Restore CLI signing subcommands and update to new types (`ea0c638`)
- Review validateCertificateStorePath adn remvoe unnecessary checks (`e0e74d3`)
- Improve goroutine cleanup in PDF operations (`c5167ff`)
- Styling of select inputs (`ace198d`)
- Make pin optional and only required for certs that require it (`da01f44`)
- Recover visible signatures (`e7cd7de`)
- Adjsut logging and comments (`08f7325`)
- Adjust loading overlay in signing (`863345a`)

### ♻️  Refactors

- Rename app (`ce44834`)
- Add coverage directory to .gitignore (`66aa35d`)
- Add error handling and constants usage (`dd36bd1`)
- Improve memory cleanup and performance patterns (`3b612af`)
- Improve error recovery and focus management (`2901eea`)
- Use shared certificateRenderer component (`fd704a5`)
- Extract constants, modal base class, and certificate renderer (`9614eff`)
- Extract magic numbers to constants and optimize configuration (`efe03ea`)
- Remove unused frontend files and clean up project structure (`d9715d9`)
- Extract shared types and restore signature logic (`6b6f3a7`)
- Rename function for coherence (`c5245c9`)
- Improve app integration (`160631a`)
- Update frontend bindings and UI (`edc2c06`)
- Improve CLI with sanitization and logging (`45cecfb`)
- Improve PDF service with better error handling (`9567826`)
- Improve config service reliability (`38d735f`)
- Improve signature backends (`a75980a`)

### 📚 Documentation

- Adjust docs (`83b37aa`)
- Update index page (`6356f44`)
- Update logo (`223fda6`)
- Remove screesnhot placeholder (`00ace7e`)
- Add screenshots (`ba56d29`)
- Add screenshots to documentation (`7938302`)
- Add docs (`d5d94e4`)
- Jsdoc for the frontend (`f327eb5`)
- Adjust documentation in all functions in backend (`ec26eb4`)
- Rename application to PDF App (`ebf279a`)

### 🧪 Tests

- Enhance test tasks to include JavaScript tests and coverage reports (`bcce33e`)
- Add advanced utils, settings, and performance tests (`0a17788`)
- Add zoom, memory leak, and integration tests (`da70dfb`)
- Add unit tests for security, state, events, and constants (`620862b`)
- Add Vitest test infrastructure with happy-dom (`aa53670`)
- Improve tests (`35dc274`)

### 🔧 Maintenance

- Add release tasks to Taskfile (`53d8731`)
- Remove unused package.json.md5 and add *.md5 to gitignore (`814d3b4`)
- Add Taskfile build automation and update gitignore (`bd10c0e`)
- Add zoom throttling, error sanitization, and JSDoc documentation (`1352903`)
- Ignore gopls configuration file (`8b0a2b1`)
- Untrack binary and update gitignore (`cc69b50`)
- Update dependencies (`3932ca3`)
- Update build scripts and configuration (`58eadc7`)

### 📦 Other Changes

- Improve signing rendering (`eb49610`)
- Icons showing in signature generation (`e562c07`)
- Start working on signature profiles (`9519950`)
- Update gitigonre (`a42cb7a`)
- Imporve shortcuts (`1962c6b`)
- Improve keyboard shortcuts (`1ee3796`)
- Initial keyboarsd shortucts configurable setup (`610611f`)
- Keyboard shortcuts working (`9548a67`)
- Poc not workinh (`4bace5d`)
- Files settings fixed (`1251113`)
- Started with configs, viewer config with zooms and panels working well (`9310cec`)
- Visible signatures working well (`8895812`)
- All signing methods working and valid signatures generated (`5f9e800`)
- Cleanup and working (`5379ed5`)
- Signatures working, NSS and PKCS#11 (`f793ef9`)
- First commit (`3872143`)

---

## Installation

### AppImage (Recommended)

```bash
# Download
curl -LO https://github.com/YOUR_ORG/lankir/releases/download/v0.1.0/lankir-0.1.0-x86_64.AppImage

# Make executable
chmod +x lankir-0.1.0-x86_64.AppImage

# Run
./lankir-0.1.0-x86_64.AppImage
```

### Static Binary

Requires GTK3, WebKit2GTK, and NSS libraries on target system.

```bash
# Download
curl -LO https://github.com/YOUR_ORG/lankir/releases/download/v0.1.0/lankir_static

# Make executable
chmod +x lankir_static

# Run
./lankir_static
```

---

## Full Changelog

Initial release
