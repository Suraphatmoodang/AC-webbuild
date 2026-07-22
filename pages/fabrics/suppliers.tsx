// Fabric suppliers (ผ้า) — a SEPARATE list from the accessory suppliers, stored in
// `fabric_suppliers`. The UI is identical to the accessory page, so this route
// renders the same parameterised view over the fabric store's supplier helpers
// rather than duplicating ~400 lines. Change supplier UI in pages/suppliers.tsx.
import { SuppliersView } from "../suppliers";
import {
  getSuppliers, addSupplier, updateSupplier, deleteSupplier, bulkDeleteSuppliers,
} from "@/lib/fabric-store";

export default function FabricSuppliersPage() {
  return (
    <SuppliersView
      section="fabric"
      api={{
        list: getSuppliers, add: addSupplier, update: updateSupplier,
        remove: deleteSupplier, bulkRemove: bulkDeleteSuppliers,
      }}
    />
  );
}
