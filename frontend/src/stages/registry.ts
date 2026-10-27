/**
 * Registro de componentes de etapa. Detecta automáticamente los archivos
 * `src/stages/<Nombre>Stage.tsx` (ej. DefinitionStage.tsx de la mitad B), así que agregar
 * uno no requiere tocar este archivo ni la vista del proyecto.
 *
 * Cada archivo debe exportar su componente como default o con el mismo nombre del archivo
 * (`export function DefinitionStage(...)`). Recibe `StageComponentProps`.
 */
import type { ComponentType } from "react";
import type { StageComponentProps, StageKind } from "../types";

type StageComponent = ComponentType<StageComponentProps<never>>;

const modules = import.meta.glob<Record<string, unknown>>("./*Stage.tsx", { eager: true });

const FILE_FOR: Record<StageKind, string> = {
  definition: "DefinitionStage",
  database: "DatabaseStage",
  backend: "BackendStage",
  frontend: "FrontendStage",
  architecture: "ArchitectureStage",
  review: "ReviewStage",
};

export function stageComponent(kind: StageKind): StageComponent | undefined {
  const name = FILE_FOR[kind];
  const mod = modules[`./${name}.tsx`];
  if (!mod) return undefined;
  return (mod.default ?? mod[name]) as StageComponent | undefined;
}
