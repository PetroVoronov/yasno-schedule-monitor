# Changelog

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
