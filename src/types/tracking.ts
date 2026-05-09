export type EstadoCanonico =
  | "creado"
  | "en_bodega_miami"
  | "en_transito"
  | "en_aduana"
  | "en_distribucion"
  | "entregado"
  | "incidencia"
  | "desconocido";

export interface TrackingEvento {
  fecha: string | null;        // ISO si parseable, sino texto crudo
  fechaTexto: string;          // crudo tal como aparece
  descripcion: string;
  ubicacion?: string;
  accion?: string;
}

export interface TrackingCosto {
  pesoLb: number;
  flete: number;
  arancel: number;
  total: number;
}

export interface TrackingResult {
  codigo: string;              // tracking ingresado por el usuario
  wr: string | null;           // WR12345
  estado: EstadoCanonico;
  estadoLabel: string;         // texto crudo del sistema
  descripcion: string | null;
  notes: string | null;        // p.ej. nombre del consignatario
  consignee: string | null;
  pesoLb: number | null;
  costo: TrackingCosto | null;
  fechaRecepcion: string | null;   // ISO o texto crudo
  fechaEstado: string | null;       // fecha del status actual
  eventos: TrackingEvento[];
  imagenes: string[];
  actualizadoEn: string;       // ISO
}

export type TrackingError =
  | { kind: "not_found" }
  | { kind: "scraper_unavailable"; detail?: string }
  | { kind: "invalid_credentials" }
  | { kind: "timeout" };
