# Spec Delta

## ADDED Requirements

### Requirement: Loaded packs work offline
A Country pack, once loaded, SHALL work without network: search, archive lookup, archive regions and borders. A new app version SHALL keep loaded packs, refreshing each the next time the app is online.

#### Scenario: Airplane mode with Austria
- **WHEN** the reader loaded the Austria pack once online and later opens the app in airplane mode
- **THEN** searching "Linz" finds it and its place sheet shows the archive answer

#### Scenario: Update keeps packs
- **WHEN** a new app version is installed while the Poland pack is on the device
- **THEN** the Poland pack is still on the device after the reload, and is refreshed the next time the app is online
