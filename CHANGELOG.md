# Changelog

## [0.8.8](https://github.com/PetroVoronov/yasno-schedule-monitor/compare/v0.8.7...v0.8.8) (2025-12-04)

### Bug Fixes

* **yasno:** today string creation ([4107525](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/41075254e8234fa84dc7cf2eea79a72dd5cbf8a2))

### Code Refactoring

* **yasno:** add more debug for telegramSendUpdate ([5aa6569](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/5aa6569fd02416f1f70b29a26754d0e6c7c2f001))

### Build System

* **deps-dev:** bump globals from 16.4.0 to 16.5.0 ([cda9bc3](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/cda9bc3afd51f222dd0ab157278a18fc2775c50f))
* **deps-dev:** bump globals from 16.4.0 to 16.5.0 ([f5d4b91](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/f5d4b911bd841e967a4d14076afd26b34aeb1d91))
* **deps:** bump axios from 1.13.1 to 1.13.2 ([543e152](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/543e152676edd61bfcc24dcac9f0d21865420690))
* **deps:** bump axios from 1.13.1 to 1.13.2 ([05c7ed9](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/05c7ed99c2a08d43bec9d891c737765e914de938))
* **deps:** bump commander from 12.1.0 to 14.0.2 ([80d28b2](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/80d28b21ac37c6b5c7b45e6639348d5282f2ba8f))
* **deps:** bump commander from 12.1.0 to 14.0.2 ([cc77a8e](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/cc77a8ee7a31c9f2ffca4648463ec49b71068f9b))
* **deps:** bump i18n from 0.15.2 to 0.15.3 ([7032e15](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/7032e156175186cc587525f239f52480f5841b21))

## [0.8.7](https://github.com/PetroVoronov/yasno-schedule-monitor/compare/v0.8.6...v0.8.7) (2025-10-31)

### Code Refactoring

* **calendar:** cache calendar events per day and invalidate on changes ([e3728ae](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/e3728aefc2b8599a43657295448b550bc63e71f6))
* **yasno:** detect unchanged API payloads via SHA256 checksum and skip processing ([df7a09f](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/df7a09f12f0152608bb1be5d772920249fbe425b))

## [0.8.6](https://github.com/PetroVoronov/yasno-schedule-monitor/compare/v0.8.5...v0.8.6) (2025-10-31)

### Code Refactoring

* **calendar:** cache private key, JWT auth and calendar service ([94928d8](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/94928d8ab5c2c451976ce7f62e0ebd738cb6bd45))

## [0.8.5](https://github.com/PetroVoronov/yasno-schedule-monitor/compare/v0.8.4...v0.8.5) (2025-10-31)

### Code Refactoring

* **cli:** migrate from yargs-parser to commander and validate schedule interval ([0d8ce71](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/0d8ce71c88e8996efe89f2811214eed836e24268))

### Miscellaneous Chores

* **deps:** bump axios to ^1.13.1 and refresh package-lock (update @messageformat/runtime to 3.0.2) ([b735456](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/b735456afb0b3196c1f728f2c33026f393480034))

## [0.8.4](https://github.com/PetroVoronov/yasno-schedule-monitor/compare/v0.8.3...v0.8.4) (2025-10-26)

### Bug Fixes

* **schedule:** use payload date string for day key and normalize date comparison ([638b009](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/638b0091e0afd6dbce613184c85d383b584bdd34))

## [0.8.3](https://github.com/PetroVoronov/yasno-schedule-monitor/compare/v0.8.2...v0.8.3) (2025-10-26)

### Bug Fixes

* **schedule:** format updatedOn using Intl.DateTimeFormat with timeZone ([5e1decd](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/5e1decd7eb8be85b34e2f3477bc5d805b40fc360))

## [0.8.2](https://github.com/PetroVoronov/yasno-schedule-monitor/compare/v0.8.1...v0.8.2) (2025-10-25)

### Bug Fixes

* **schedule:** validate formatted day string and skip duplicate day entries; add debug log for day data processing ([cea8f58](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/cea8f58aadad72f405ea6e27f9cd7692067dbabf))

## [0.8.1](https://github.com/PetroVoronov/yasno-schedule-monitor/compare/v0.8.0...v0.8.1) (2025-10-25)

### Bug Fixes

* **schedule:** skip Telegram notifications when all events are in the past (filter out past events) ([567d2ba](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/567d2ba79a96e0d7590d86e039413364c60667dd))

### Code Refactoring

* **schedule:** remove previousData diffing and simplify update flow ([9ba0b95](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/9ba0b95b4c7273486a5f000a2d03803d8d85b03a))

## [0.8.0](https://github.com/PetroVoronov/yasno-schedule-monitor/compare/v0.7.1...v0.8.0) (2025-10-25)

### Features

* **schedule:** compare per-group per-day intervals and propagate update timestamps ([86da155](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/86da155d85ff13d30552d35daf17af4cad35e8ab))

### Code Refactoring

* **logging:** use timezone-aware Intl.DateTimeFormat for timestamps and add setTimeZone ([27c26ed](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/27c26ed69431d017a3a1266a6e1e0ff3f052b20c))
* **schedule,telegram:** centralize timezone, simplify outage transform, and make Telegram messaging async/await ([49134b3](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/49134b36484b43485dce03d63f4205db1c6e61d7))

### Build System

* **deps-dev:** bump @babel/core from 7.28.4 to 7.28.5 ([05ba1ac](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/05ba1accd71d204d1938f97988490cc2236747a0))
* **deps-dev:** bump @babel/core from 7.28.4 to 7.28.5 ([828ec02](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/828ec029c11e9a308f7dd66e27a7f57301858521))
* **deps-dev:** bump @babel/eslint-parser from 7.28.4 to 7.28.5 ([6001aa1](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/6001aa11f0978b6f02acfe79c610b37eb3faa21b))
* **deps-dev:** bump @babel/eslint-parser from 7.28.4 to 7.28.5 ([0bac3aa](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/0bac3aa197d6f35ed91dedf827f0b2776482e0ff))
* **deps:** bump yargs-parser from 21.1.1 to 22.0.0 ([5e1a7ec](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/5e1a7ec63325ded78f3df26dcea8e73bc092a89b))
* **deps:** bump yargs-parser from 21.1.1 to 22.0.0 ([303ca6e](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/303ca6ea78208c9e4c83c4b3071066f5f9e0ad5d))

## [0.7.1](https://github.com/PetroVoronov/yasno-schedule-monitor/compare/v0.7.0...v0.7.1) (2025-10-23)

### Bug Fixes

* **schedule:** detect changes using per-group signatures and propagate update timestamps ([4989714](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/4989714aa226f42f170957bc3fea41b95c76b135))

### Miscellaneous Chores

* **vscode:** add launch.json to configure Node.js debugger ([4db391d](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/4db391dbda57478047ccec8236ed2186dd2c2bc1))

## [0.7.0](https://github.com/PetroVoronov/yasno-schedule-monitor/compare/v0.6.1...v0.7.0) (2025-10-23)

### Features

* **cli:** replace yargs with yargs-parser and improve CLI handling ([f87a736](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/f87a736dc6b1b72194c08aefec309ad7ecbba38d))
* **schedule:** adapt to new Yasno API schema and improve update handling ([3c83000](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/3c8300089ecb30880a9ee0258358ea549c05baf9))
* **schedule:** add --ignore-status flag and handle schedule status ([4ee2a42](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/4ee2a42fcdbe65ca9bca44bb1fe82426bbc056ba))

### Miscellaneous Chores

* **deps:** bump dependencies and devDependencies ([f87a736](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/f87a736dc6b1b72194c08aefec309ad7ecbba38d))
* **deps:** bump googleapis to ^164.1.0 and adapt code for new client API ([a3fbda9](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/a3fbda92cff7f7d692ce5e74227eaa83005274f1))
* **locales:** add "Data updated at {timestamp}" key and fix trailing commas in en/de/uk JSON files ([9abc39e](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/9abc39e221e91df34935a5c3b4243ab78b2b7899))

### Documentation

* **commit-message-instructions:** Add comprehensive commit message guide ([b16811e](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/b16811e5c38f7a44f3a9e2c8f996678a7855e07e))

## [0.6.1](https://github.com/PetroVoronov/yasno-schedule-monitor/compare/v0.6.0...v0.6.1) (2024-12-26)

### Code Refactoring

* **logging:** replace SecuredLogger implementation with `logform` and `triple-beam` due to the `gramjs` Logger extension no more exported ([e0cfb56](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/e0cfb5671aec3e6a98a3dc677e18df8253fa2393))

## [0.6.0](https://github.com/PetroVoronov/yasno-schedule-monitor/compare/v0.5.0...v0.6.0) (2024-12-26)

### Features

* add "no outages!" message in case of "empty" schedule and update localization files ([38dd967](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/38dd967f5918257c776b33c071a628b4cd1d493f))

### Build System

* **deps-dev:** bump globals from 15.13.0 to 15.14.0 ([372b69c](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/372b69ca02c847c7e34a0b039514bf93ebbf5ec5))
* **deps-dev:** bump markdownlint-cli2 from 0.16.0 to 0.17.0 ([32ade2d](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/32ade2de77e7a730898439dc44a4d6158d8fec60))
* **deps:** bump telegram from 2.26.8 to 2.26.12 ([6779928](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/67799283efcef345f7083a2a6bd1dd6a5b2ebe17))

## [0.5.0](https://github.com/PetroVoronov/yasno-schedule-monitor/compare/v0.4.5...v0.5.0) (2024-12-16)

### Features

* Updated to work with sub groups ([6b081da](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/6b081da97687520a3fa71ff94e3bd2cd70894069))

### Build System

* **deps-dev:** bump markdownlint-cli2 from 0.15.0 to 0.16.0 ([c8448ef](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/c8448ef5ef7477e4702e125b582dbd34659ac916))

## [0.4.5](https://github.com/PetroVoronov/yasno-schedule-monitor/compare/v0.4.4...v0.4.5) (2024-12-06)

### Bug Fixes

* **i18n:** update Ukrainian translation for power outage message ([fe2cfb4](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/fe2cfb4a75902960d57f860b72889fff1375fe08))

### Code Refactoring

* improve group handling logic and clean up code formatting ([fe2cfb4](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/fe2cfb4a75902960d57f860b72889fff1375fe08))

## [0.4.4](https://github.com/PetroVoronov/yasno-schedule-monitor/compare/v0.4.3...v0.4.4) (2024-12-06)

### Code Refactoring

* all groups added ([123923e](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/123923e15832a9c1484480335465ab6a554e3459))

## [0.4.3](https://github.com/PetroVoronov/yasno-schedule-monitor/compare/v0.4.2...v0.4.3) (2024-12-06)

### Code Refactoring

* text for events and messages ([5218402](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/5218402dc136f095cf94b7b4b0897ebf31c79a4d))

## [0.4.2](https://github.com/PetroVoronov/yasno-schedule-monitor/compare/v0.4.1...v0.4.2) (2024-12-05)

### Bug Fixes

* update Ukrainian translation for power outage message to include placeholder ([60639ee](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/60639eecb93683c9beeeed9133b4f72a821f339e))

## [0.4.1](https://github.com/PetroVoronov/yasno-schedule-monitor/compare/v0.4.0...v0.4.1) (2024-12-05)

### Code Refactoring

* update calendar event summary - number of group is added ([e5ef1f4](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/e5ef1f49a0d674f4e809ee94906d84e691aeb074))

## [0.4.0](https://github.com/PetroVoronov/yasno-schedule-monitor/compare/v0.3.1...v0.4.0) (2024-12-05)

### Features

* **locales:** add English and Ukrainian translations for power outage notifications ([dfb2aac](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/dfb2aac2a3ed9759fca1327699d8df29e9a3a725))
* Telegram notifications are implemented ([dfb2aac](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/dfb2aac2a3ed9759fca1327699d8df29e9a3a725))

### Bug Fixes

* remove unnecessary condition in telegram notification logic ([1dd4109](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/1dd4109cde0e6fa06d96c3367bdceadc9027aad3))

### Code Refactoring

* send notification only for configured groups ([eea845f](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/eea845f38a898f4c633e72d8d63086563a26b1e5))

### Build System

* **deps:** bump axios from 1.7.8 to 1.7.9 ([1900c0b](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/1900c0babcb2d3f8987441770e93b826403a9946))
* **deps:** bump grammy from 1.32.0 to 1.33.0 ([891d45d](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/891d45d55aa5641c2e74e062ce81bcc85a7f2165))

## [0.3.1](https://github.com/PetroVoronov/yasno-schedule-monitor/compare/v0.3.0...v0.3.1) (2024-12-04)

### Bug Fixes

* improve logging format for target date in update checks ([25a5f15](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/25a5f1548c19cac3b10a2159199af6f1f6f7a243))

## [0.3.0](https://github.com/PetroVoronov/yasno-schedule-monitor/compare/v0.2.0...v0.3.0) (2024-12-04)

### Features

* enhance schedule update processing with date parsing functionality ('title' field) ([1b45d91](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/1b45d91a7d828450ab6922850ab1807b1d21393e))

## [0.2.0](https://github.com/PetroVoronov/yasno-schedule-monitor/compare/v0.1.0...v0.2.0) (2024-12-03)

### Features

* basic download data, check and parsing of intervals ([533c84e](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/533c84ed27824fbd348af0998ac7ce662ddff612))
* **docker:** add Dockerfile for containerization ([ebf33ca](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/ebf33cad5192abd264f9f240e5ceb0277f47715e))
* first fully functional release from calendar side ([ebf33ca](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/ebf33cad5192abd264f9f240e5ceb0277f47715e))
* integrate Google Calendar API for schedule updates and add googleapis dependency ([15a0ee8](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/15a0ee819fcffdee37bc147ed582ba3cc963b401))

### Code Refactoring

* include date-fns-tz dependency, and update cspell configuration ([ebf33ca](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/ebf33cad5192abd264f9f240e5ceb0277f47715e))

### Miscellaneous Chores

* **ci:** docker image build is added ([ebf33ca](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/ebf33cad5192abd264f9f240e5ceb0277f47715e))

## [0.1.0](https://github.com/PetroVoronov/yasno-schedule-monitor/compare/v0.0.1...v0.1.0) (2024-12-02)

### Features

* initialize project with configuration files and basic structure ([5603892](https://github.com/PetroVoronov/yasno-schedule-monitor/commit/5603892bad64d49fa7374e49b9059bcf548dfcf8))
