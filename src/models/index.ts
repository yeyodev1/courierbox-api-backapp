import { Payment } from "./payment.model.js";
import { User } from "./user.model.js";
import { MasterCliente } from "./master_cliente.model.js";
import { ClienteAlias } from "./cliente_alias.model.js";
import { Paquete } from "./paquete.model.js";
import { Factura } from "./factura.model.js";
import { FeeConfig } from "./fee_config.model.js";
import { PurchaseOrder } from "./purchase_order.model.js";
import { Gasto } from "./gasto.model.js";
import { EnvioDomicilio } from "./envio_domicilio.model.js";

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
};
