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
};
