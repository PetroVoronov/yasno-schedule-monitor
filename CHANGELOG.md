# Changelog

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
