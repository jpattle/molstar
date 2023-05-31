import { Column, Table } from "../../mol-data/db";
import { CifBlock, CifCategory, CifFrame } from "../../mol-io/reader/cif";
import { mmCIF_Schema } from "../../mol-io/reader/cif/schema/mmcif";
import { mockData as staticBondData } from "./pdb-mock-data";

const chemCompBondName = "chem_comp_bond";

export type ChemCompBondTable = Table<mmCIF_Schema["chem_comp_bond"]>;

const getChemCompBondTable = (): ChemCompBondTable => {
  return Table.ofPartialColumns(
    mmCIF_Schema.chem_comp_bond,
    {
      comp_id: Column.ofStringArray(staticBondData.compId),
      atom_id_1: Column.ofStringArray(staticBondData.atomId1),
      atom_id_2: Column.ofStringArray(staticBondData.atomId2),
      value_order: Column.ofStringAliasArray(staticBondData.valueOrder),
      pdbx_aromatic_flag: Column.ofStringAliasArray(
        staticBondData.pdbxAromaticFlag
      ),
      pdbx_stereo_config: Column.ofStringAliasArray(
        staticBondData.pdbxStereoConfig
      ),
      pdbx_ordinal: Column.ofIntArray(staticBondData.pdbxOrdinal),
    },
    staticBondData.compId.length
  );
};

const generateChemCompBondCategory = (): {
  category: CifCategory;
  table: ChemCompBondTable;
} => {
  const table = getChemCompBondTable();
  return { category: CifCategory.ofTable(chemCompBondName, table), table };
};

export const addChemCompBondCategory = (
  cif: CifFrame
): { newCif: CifFrame; chemCompBondTable: ChemCompBondTable } => {
  const { category, table } = generateChemCompBondCategory();
  // return cif
  const newCif = {
    ...cif,
    categoryNames: [...cif.categoryNames, chemCompBondName],
    categories: { ...cif.categories, [chemCompBondName]: category },
  };

  console.log("ADDED BOND ORDERS!", newCif);
  return { newCif, chemCompBondTable: table };
};

export const addBondOrdersCif = (
  cif: CifBlock | undefined
): CifBlock | undefined => {
  console.log("trying for cif");
  if (!cif) {
    return cif;
  }

  if (cif.categoryNames.includes(chemCompBondName)) {
    console.log("chem comp bond already exists");
    return cif;
  }

  const { category } = generateChemCompBondCategory();

  // return cif
  const newCif = {
    ...cif,
    categoryNames: [...cif.categoryNames, chemCompBondName],
    categories: { ...cif.categories, [chemCompBondName]: category },
  };
  console.log("ADDED BOND ORDERS!", newCif);
  return newCif;
};
