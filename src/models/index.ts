import { Payment } from "./payment.model";
import { User } from "./user.model";
import { MasterCliente } from "./master_cliente.model";
import { ClienteAlias } from "./cliente_alias.model";
import { Paquete } from "./paquete.model";
import { Factura } from "./factura.model";
import { FeeConfig } from "./fee_config.model";
import { PurchaseOrder } from "./purchase_order.model";
import { Gasto } from "./gasto.model";
import { EnvioDomicilio } from "./envio_domicilio.model";
import { Proveedor } from "./proveedor.model";
import { ProviderTypeCatalog } from "./provider_type_catalog.model";
import { CajaMovimiento } from "./caja_movimiento.model";
import { ProduccionDiaria } from "./produccion_diaria.model";
import { Contacto } from "./contacto.model";
import { CuentaBancaria } from "./cuenta_bancaria.model";
import { GestionCompra } from "./gestion_compra.model";
import { Notificacion } from "./notificacion.model";
import { MovimientoFinanciero } from "./movimiento_financiero.model";
import { RetiroCounter } from "./retiro_counter.model";
import { SolicitudCompra } from "./solicitud_compra.model";
import { ProductoInventario } from "./producto_inventario.model";
import { VentaProducto } from "./venta_producto.model";

export const models = {
  payments: Payment,
  users: User,
  masterClientes: MasterCliente,
  clienteAliases: ClienteAlias,
  paquetes: Paquete,
  facturas: Factura,
  feeConfigs: FeeConfig,
  purchaseOrders: PurchaseOrder,
  gastos: Gasto,
  enviosDomicilio: EnvioDomicilio,
  proveedores: Proveedor,
  providerTypeCatalog: ProviderTypeCatalog,
  cajaMovimientos: CajaMovimiento,
  produccionDiaria: ProduccionDiaria,
  contactos: Contacto,
  cuentasBancarias: CuentaBancaria,
  gestionesCompra: GestionCompra,
  notificaciones: Notificacion,
  movimientosFinancieros: MovimientoFinanciero,
  retirosCounter: RetiroCounter,
  solicitudesCompra: SolicitudCompra,
  productosInventario: ProductoInventario,
  ventasProducto: VentaProducto,
};
