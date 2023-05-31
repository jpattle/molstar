import { Column } from "../../mol-data/db";
import { parsePDB } from "../../mol-io/reader/pdb/parser";
import { PdbFile } from "../../mol-io/reader/pdb/schema";
import { createModels } from "../../mol-model-formats/structure/basic/parser";
import { createBasic } from "../../mol-model-formats/structure/basic/schema";
import {
  MmcifFormat,
  trajectoryFromMmCIF,
} from "../../mol-model-formats/structure/mmcif";
import { PdbFormat } from "../../mol-model-formats/structure/pdb";
import {
  ChemCompBondTable,
  addBondOrdersCif,
  addChemCompBondCategory,
} from "./pdb-add-mock-bond-orders";
import { pdbToMmCif } from "../../mol-model-formats/structure/pdb/to-cif";
import { ComponentBond } from "../../mol-model-formats/structure/property/bonds/chem_comp";
import { AtomPartialCharge } from "../../mol-model-formats/structure/property/partial-charge";
import { ArrayTrajectory, Model, Trajectory } from "../../mol-model/structure";
import { guessCifVariant } from "../../mol-plugin-state/formats/provider";
import {
  MmcifProvider,
  PdbProvider,
  TrajectoryFormatCategory,
  TrajectoryFormatProvider,
} from "../../mol-plugin-state/formats/trajectory";
import {
  PluginStateObject as SO,
  PluginStateTransform,
} from "../../mol-plugin-state/objects";
import { StateTransforms } from "../../mol-plugin-state/transforms";
import { StateTransformer } from "../../mol-state";
import { Task } from "../../mol-task";
import { ParamDefinition as PD } from "../../mol-util/param-definition";

function trajectoryProps(trajectory: Trajectory) {
  const first = trajectory.representative;
  return {
    label: `${first.entry}`,
    description: `${trajectory.frameCount} model${
      trajectory.frameCount === 1 ? "" : "s"
    }`,
  };
}

type TrajectoryFromMmCifWithBondOrders =
  typeof TrajectoryFromMmCifWithBondOrders;
const TrajectoryFromMmCifWithBondOrders = PluginStateTransform.BuiltIn({
  name: "trajectory-from-mmcif-with-bond-orders",
  display: {
    name: "Trajectory from mmCIF with Bond Orders",
    description:
      "Identify and create all separate models in the specified CIF data block",
  },
  from: SO.Format.Cif,
  to: SO.Molecule.Trajectory,
  params(a) {
    if (!a) {
      return {
        loadAllBlocks: PD.Optional(
          PD.Boolean(false, {
            description:
              "If True, ignore Block Header parameter and parse all datablocks into a single trajectory.",
          })
        ),
        blockHeader: PD.Optional(
          PD.Text(void 0, {
            description:
              "Header of the block to parse. If none is specifed, the 1st data block in the file is used.",
            hideIf: (p) => p.loadAllBlocks === true,
          })
        ),
      };
    }
    const { blocks } = a.data;
    return {
      loadAllBlocks: PD.Optional(
        PD.Boolean(false, {
          description:
            "If True, ignore Block Header parameter and parse all data blocks into a single trajectory.",
        })
      ),
      blockHeader: PD.Optional(
        PD.Select(
          blocks[0] && blocks[0].header,
          blocks.map((b) => [b.header, b.header] as [string, string]),
          {
            description: "Header of the block to parse",
            hideIf: (p) => p.loadAllBlocks === true,
          }
        )
      ),
    };
  },
})({
  isApplicable: (a) => a.data.blocks.length > 0,
  apply({ a, params }) {
    return Task.create("Parse mmCIF with Bond Orders", async (ctx) => {
      let trajectory: Trajectory;
      if (params.loadAllBlocks) {
        const models: Model[] = [];
        for (const block of a.data.blocks) {
          if (ctx.shouldUpdate) {
            await ctx.update(`Parsing ${block.header}...`);
          }
          const t = await trajectoryFromMmCIF(block).runInContext(ctx);
          for (let i = 0; i < t.frameCount; i++) {
            models.push(await Task.resolveInContext(t.getFrameAtIndex(i), ctx));
          }
        }
        trajectory = new ArrayTrajectory(models);
      } else {
        const header = params.blockHeader || a.data.blocks[0].header;
        // const block = a.data.blocks.find(b => b.header === header)
        const block = addBondOrdersCif(
          a.data.blocks.find((b) => b.header === header)
        );
        if (!block) throw new Error(`Data block '${[header]}' not found.`);
        trajectory = await trajectoryFromMmCIF(block).runInContext(ctx);
      }
      if (trajectory.frameCount === 0) throw new Error("No models found.");
      const props = trajectoryProps(trajectory);
      return new SO.Molecule.Trajectory(trajectory, props);
    });
  },
});

export const MmcifWithBondOrdersProvider: TrajectoryFormatProvider = {
  label: "mmCIF (BO)",
  description: "mmCIF",
  category: TrajectoryFormatCategory,
  stringExtensions: ["cif", "mmcif", "mcif"],
  binaryExtensions: ["bcif"],
  isApplicable: (info, data) => {
    if (info.ext === "mmcif" || info.ext === "mcif") return true;
    // assume undetermined cif/bcif files are mmCIF
    if (info.ext === "cif" || info.ext === "bcif")
      return guessCifVariant(info, data) === -1;
    return false;
  },
  parse: async (plugin, data, params) => {
    const state = plugin.state.data;
    const cif = state
      .build()
      .to(data)
      .apply(StateTransforms.Data.ParseCif, void 0, {
        state: { isGhost: true },
      });
    const trajectory = await cif
      .apply(TrajectoryFromMmCifWithBondOrders, void 0, {
        tags: params?.trajectoryTags,
      })
      .commit({ revertOnError: true });

    if ((cif.selector.cell?.obj?.data.blocks.length || 0) > 1) {
      plugin.state.data.updateCellState(cif.ref, { isGhost: false });
    }

    return { trajectory };
  },
  visuals: MmcifProvider.visuals,
};

const setComponentBond = (
  models: ArrayTrajectory,
  table: ChemCompBondTable
) => {
  const model = models.representative;
  const data = ComponentBond.chemCompBondFromTable(model, table);
  const entries = ComponentBond.getEntriesFromChemCompBond(data);
  ComponentBond.Provider.set(model, { data, entries });
  console.log(
    "SET BONDS IN THE PROVIDER",
    model,
    data,
    entries,
    ComponentBond.Provider.get(model),
    ComponentBond.Provider
  );
};

export function trajectoryFromPDB(pdb: PdbFile): Task<Trajectory> {
  return Task.create("Parse PDB", async (ctx) => {
    await ctx.update("Converting to mmCIF");
    const { newCif: cif, chemCompBondTable } = addChemCompBondCategory(
      await pdbToMmCif(pdb)
    );
    //   const cif = await pdbToMmCif(pdb)
    const format = MmcifFormat.fromFrame(cif, undefined, PdbFormat.create(pdb));
    const basic = createBasic(format.data.db, true);
    const models = await createModels(basic, format, ctx);
    setComponentBond(models, chemCompBondTable);
    const partial_charge =
      cif.categories["atom_site"]?.getField("partial_charge");
    if (partial_charge) {
      // TODO works only for single, unsorted model, to work generally
      //      would need to do model splitting again
      if (models.frameCount === 1) {
        const first = models.representative;
        const srcIndex = first.atomicHierarchy.atomSourceIndex;
        const isIdentity = Column.isIdentity(srcIndex);
        const srcIndexArray = isIdentity
          ? void 0
          : srcIndex.toArray({ array: Int32Array });

        const q = partial_charge.toFloatArray();
        const partialCharge = srcIndexArray
          ? Column.ofFloatArray(
              Column.mapToArray(srcIndex, (i) => q[i], Float32Array)
            )
          : Column.ofFloatArray(q);

        AtomPartialCharge.Provider.set(first, {
          data: partialCharge,
          type: "GASTEIGER", // from PDBQT
        });
      }
    }
    return models;
  });
}

type TrajectoryFromPDBWithBondOrders = typeof TrajectoryFromPDBWithBondOrders;
const TrajectoryFromPDBWithBondOrders = PluginStateTransform.BuiltIn({
  name: "trajectory-from-pdb-with-bond-orders",
  display: {
    name: "Parse PDB with Bond Orders",
    description: "Parse PDB string and create trajectory.",
  },
  from: [SO.Data.String],
  to: SO.Molecule.Trajectory,
  params: {
    isPdbqt: PD.Boolean(false),
  },
})({
  apply({ a, params }) {
    return Task.create("Parse PDB with BondOrders", async (ctx) => {
      const parsed = await parsePDB(
        a.data,
        a.label,
        params.isPdbqt
      ).runInContext(ctx);
      if (parsed.isError) throw new Error(parsed.message);
      const models = await trajectoryFromPDB(parsed.result).runInContext(ctx);
      const props = trajectoryProps(models);
      return new SO.Molecule.Trajectory(models, props);
    });
  },
});

function directTrajectory<P extends {}>(
  transformer: StateTransformer<
    SO.Data.String | SO.Data.Binary,
    SO.Molecule.Trajectory,
    P
  >,
  transformerParams?: P
): TrajectoryFormatProvider["parse"] {
  return async (plugin, data, params) => {
    const state = plugin.state.data;
    const trajectory = await state
      .build()
      .to(data)
      .apply(transformer, transformerParams, { tags: params?.trajectoryTags })
      .commit({ revertOnError: true });
    return { trajectory };
  };
}

export const PdbWithBondOrdersProvider: TrajectoryFormatProvider = {
  label: "PDB (BO)",
  description: "PDB",
  category: TrajectoryFormatCategory,
  stringExtensions: ["pdb", "ent"],
  parse: directTrajectory(TrajectoryFromPDBWithBondOrders),
  visuals: PdbProvider.visuals,
};
