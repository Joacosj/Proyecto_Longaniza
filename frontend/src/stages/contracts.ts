/**
 * Tipos de los artefactos, tomados directamente del contrato del backend para no duplicarlos.
 * Es un import solo de tipos: desaparece al compilar, así que el frontend no depende del
 * código del backend en tiempo de ejecución.
 */
export type {
  ArchitectureArtifact,
  ArchitectureTemplate,
  BackendArtifact,
  Field,
  FrontendArtifact,
} from "../../../backend/src/contracts/artifacts";
