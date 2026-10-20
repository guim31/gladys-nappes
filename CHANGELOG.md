# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- One device per groundwater station of the French ADES network (Hub'Eau
  Piézométrie): depth of the water table, its level (m NGF), a situation index
  from 1 to 5, the situation in words and the date of the last measurement.
- The situation (very low to very high), estimated from the history of the
  station: the last 10 days compared with the same days of every previous year.
- Stations by code (new or old BSS code) or around the house; a "Find stations"
  action around the house, in a commune, a department or by code.
- Scene triggers: "Groundwater situation changes" and "Station without
  measurement" (7, 15, 30 or 60 days).
- A dashboard widget: the followed stations with depth, situation and trend, or
  the detail of one station.
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-nappes/commits/main
