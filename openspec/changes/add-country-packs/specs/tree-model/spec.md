# Spec Delta

## ADDED Requirements

### Requirement: Municipalities in several countries
A Place's link to today's Municipality SHALL name the country (Czechia, Austria, Germany or Poland) and the Municipality's official code in that country's format. Existing links SHALL become Czech links with their codes unchanged.

#### Scenario: Austrian Place
- **WHEN** a Member proposes a Place in Upper Austria linked to its Gemeinde
- **THEN** the link stores Austria and the 5-digit Gemeindekennziffer, and a 6-digit code is refused for Austria

#### Scenario: Existing Czech Place
- **WHEN** the migration runs on a Tree with Places linked to Czech Municipalities
- **THEN** each link names Czechia and keeps its 6-digit code and name

### Requirement: Polish and Russian names
Place names SHALL accept Polish and Russian next to Czech, German and Latin. A Person's Name SHALL accept a Polish form and a Russian form next to the Latin and German forms.

#### Scenario: Name from a Russian-language register
- **WHEN** a baptism of 1880 from the former Russian partition records a man in Russian
- **THEN** the Russian spelling is kept as his Russian form, exactly as found, next to his primary Polish Name

### Requirement: Civil registers as Sources
A Source SHALL be able to be a civil register (a Standesamt or civil registry office book), next to parish registers, censuses, land books and Family accounts.

#### Scenario: Standesamt birth
- **WHEN** a Member cites a birth from a German civil register of 1890
- **THEN** the Citation points to a Source of type civil register

### Requirement: Parishes have a Denomination
A Parish SHALL have a Denomination: Catholic, Greek Catholic, Protestant, Orthodox or other. Existing Parishes SHALL become Catholic. A Place MAY belong to Parishes of different Denominations during the same period.

#### Scenario: Two churches in one village
- **WHEN** a village belonged to a Catholic Parish and a Protestant Parish at the same time
- **THEN** the Place links to both for the same period, and each Parish shows its Denomination

### Requirement: House numbers with fractions
A house number SHALL be digits, optionally followed by one letter or by a fraction (½, ⅓, ¼, or written as 1/2), as numbers were given when homesteads were divided.

#### Scenario: Divided homestead
- **WHEN** a Member records a House in Bavaria numbered 23½
- **THEN** the number is accepted and shown as 23½, and "23 1/2" is stored the same way
