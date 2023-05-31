# Test Files

* **1udt.cif** - Original cif (not updated) from pdbe. Does not contain bond orders
* **1udt_updated.cif** - Updated cif from pdbe. Contains bond orders
* **1udt no BO.pdb** - A PDB generated from the original cif using OE Spruce. Does not contain bond orders

# Testing and observations

* **1udt_updated.cif** loaded with **Auto** - Bond orders correct

* **1udt.cif** loaded with **Auto** - Bond orders incorrect
* **1udt.cif** loaded with **mmCIF (BO)** - Bond orders correct, matches 1udt_updated.cif

* **1udt no BO.pdb** loaded with **Auto** - Bond orders incorrect
* **1udt no BO.pdb** loaded with **PDB (BO)** - Bond orders incorrect, expected bond orders to be injected but not found