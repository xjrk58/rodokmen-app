# One PostgreSQL database, no graph database

The Tree, Proposals, history and accounts all live in one PostgreSQL database with PostGIS, and family relationships are queried with recursive SQL. A graph database was the first idea, since a family tree is a graph, but a tree of a few thousand Persons is small. One transactional store keeps all of a Proposal's changes atomic with its review state and its history, and leaves one system to run and back up.
