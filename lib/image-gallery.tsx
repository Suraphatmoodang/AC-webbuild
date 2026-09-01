import { useRef, useState } from "react";
import { uploadImage, deleteImageObject, imageUrl, thumbUrl, imagesConfigured, IMAGE_ACCEPT,
  type StoredImage, type ImageScope } from "./images";

// ── Entry image gallery — shared by อุปกรณ์ / ผ้า / ออเดอร์ ────────────────────
//
// Add, view and remove the photos on one entry. Images PERSIST IMMEDIATELY through
// `onPersist` rather than riding along with the surrounding form's save button, for the
// same reason the stock lock does: the bytes are already in R2 the moment the upload
// finishes, so waiting for a บันทึก that may never come would leave paid-for files that
// nothing references. It also means a form save can never clobber the images, and
// พนักงาน can add a photo without re-saving the whole record.
//
// Ordering is meaningful: images[0] is the entry's thumbnail everywhere else, so each
// image has a "ตั้งเป็นรูปหลัก" action rather than a drag-reorder (one tap, works on a
// phone, and covers the only reordering anyone actually wants).

export function ImageGallery({ images, scope, id, onPersist, onError, readOnly, max = 8 }: {
  images: StoredImage[];
  scope: ImageScope;
  id: string;
  onPersist: (next: StoredImage[]) => Promise<void>;
  onError?: (msg: string) => void;
  readOnly?: boolean;
  max?: number;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [viewing, setViewing] = useState<StoredImage | null>(null);
  const [confirmDel, setConfirmDel] = useState<StoredImage | null>(null);

  const fail = (msg: string) => onError?.(msg);

  const pick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = max - images.length;
    if (room <= 0) { fail(`ใส่รูปได้สูงสุด ${max} รูปต่อรายการ`); return; }

    const chosen = Array.from(files).slice(0, room);
    if (files.length > room) fail(`ใส่ได้อีก ${room} รูป — รูปที่เกินถูกข้ามไป`);

    setBusy(true);
    const added: StoredImage[] = [];
    for (let i = 0; i < chosen.length; i++) {
      setProgress({ done: i, total: chosen.length });
      try {
        added.push(await uploadImage(chosen[i], scope, id));
      } catch (e: any) {
        fail(e?.message ?? "อัปโหลดไม่สำเร็จ");
      }
    }
    setProgress(null);

    // Persist whatever made it up, even if some files failed — a partial success must
    // not throw away the images that did upload.
    if (added.length > 0) {
      try {
        await onPersist([...images, ...added]);
      } catch (e: any) {
        fail(e?.message ?? "บันทึกรูปไม่สำเร็จ");
      }
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";   // so the same file can be re-picked
  };

  const remove = async (img: StoredImage) => {
    setBusy(true);
    try {
      // Row first, then the object: the reverse order can leave an entry pointing at a
      // file that no longer exists (see the note in pages/api/images/delete.ts).
      await onPersist(images.filter((i) => i.key !== img.key));
      await deleteImageObject(img);   // removes the full image AND its thumbnail
      setConfirmDel(null);
      if (viewing?.key === img.key) setViewing(null);
    } catch (e: any) {
      fail(e?.message ?? "ลบรูปไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const makeCover = async (img: StoredImage) => {
    setBusy(true);
    try {
      await onPersist([img, ...images.filter((i) => i.key !== img.key)]);
    } catch (e: any) {
      fail(e?.message ?? "ตั้งรูปหลักไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  if (!imagesConfigured()) {
    return (
      <div style={{ fontSize: 13, color: "var(--text3)" }}>
        ยังไม่ได้ตั้งค่าที่เก็บรูป (NEXT_PUBLIC_R2_PUBLIC_BASE)
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {images.map((img, idx) => (
          <div key={img.key} style={{ position: "relative", width: 84, height: 84, borderRadius: "var(--r)",
            overflow: "hidden", border: `1px solid ${idx === 0 ? "var(--accent)" : "var(--border)"}`, background: "var(--bg3)" }}>
            {/* Grid tiles load the ~20 KB thumbnail; only the viewer fetches the full image. */}
            <img src={thumbUrl(img)} alt={img.name} title={img.name}
              onClick={() => setViewing(img)}
              style={{ width: "100%", height: "100%", objectFit: "cover", cursor: "pointer", display: "block" }} />
            {idx === 0 && (
              <span style={{ position: "absolute", left: 0, bottom: 0, right: 0, background: "rgba(37,99,235,0.85)",
                color: "#fff", fontSize: 10, textAlign: "center", lineHeight: "15px" }}>
                รูปหลัก
              </span>
            )}
            {!readOnly && (
              <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmDel(img); }}
                title="ลบรูปนี้"
                style={{ position: "absolute", top: 2, right: 2, width: 20, height: 20, padding: 0, lineHeight: "18px",
                  borderRadius: 999, border: "none", background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 12, cursor: "pointer" }}>
                ✕
              </button>
            )}
          </div>
        ))}

        {!readOnly && images.length < max && (
          <button type="button" onClick={(e) => { e.preventDefault(); fileRef.current?.click(); }} disabled={busy}
            style={{ width: 84, height: 84, borderStyle: "dashed", color: "var(--text3)", fontSize: 12,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, cursor: "pointer" }}>
            <span style={{ fontSize: 20, lineHeight: 1 }}>＋</span>
            {busy && progress ? `${progress.done + 1}/${progress.total}` : busy ? "กำลังอัปโหลด…" : "เพิ่มรูป"}
          </button>
        )}
      </div>

      {images.length === 0 && readOnly && (
        <div style={{ fontSize: 13, color: "var(--text3)" }}>ไม่มีรูป</div>
      )}

      <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} multiple hidden
        onChange={(e) => pick(e.target.files)} />

      {/* Full-size viewer */}
      {viewing && (
        <div className="modal-overlay" onClick={() => setViewing(null)} style={{ zIndex: 400 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: "var(--bg2)", borderRadius: "var(--r)", padding: 12, maxWidth: "min(900px, 92vw)", maxHeight: "90vh",
              display: "flex", flexDirection: "column", gap: 10 }}>
            <img src={imageUrl(viewing.key)} alt={viewing.name}
              style={{ maxWidth: "100%", maxHeight: "70vh", objectFit: "contain", borderRadius: "var(--r)" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis" }}>{viewing.name}</span>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                {!readOnly && images[0]?.key !== viewing.key && (
                  <button type="button" onClick={() => makeCover(viewing)} disabled={busy}>ตั้งเป็นรูปหลัก</button>
                )}
                <a href={imageUrl(viewing.key)} target="_blank" rel="noreferrer"
                  style={{ alignSelf: "center", fontSize: 13, color: "var(--accent)" }}>เปิดในแท็บใหม่</a>
                <button type="button" onClick={() => setViewing(null)}>ปิด</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm — the file is gone from R2 for good, so ask first. */}
      {confirmDel && (
        <div className="modal-overlay" onClick={() => setConfirmDel(null)} style={{ zIndex: 400 }}>
          <div className="modal" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight: 500, color: "var(--red)" }}>ลบรูปนี้</div>
              <button type="button" className="ghost" style={{ padding: "4px 8px" }} onClick={() => setConfirmDel(null)}>✕</button>
            </div>
            <div className="modal-body">
              <img src={thumbUrl(confirmDel)} alt={confirmDel.name}
                style={{ width: "100%", maxHeight: 200, objectFit: "contain", borderRadius: "var(--r)", background: "var(--bg3)" }} />
              <p style={{ fontSize: 13, color: "var(--text3)", marginTop: 8 }}>ไฟล์จะถูกลบออกจากที่เก็บถาวร กู้คืนไม่ได้</p>
            </div>
            <div className="modal-footer">
              <button type="button" onClick={() => setConfirmDel(null)}>ยกเลิก</button>
              <button type="button" className="danger" disabled={busy} onClick={() => remove(confirmDel)}>
                {busy ? "กำลังลบ…" : "ลบรูป"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Small first-image thumbnail for browse tables. Renders nothing when the entry has no
// image, so a table of mostly-imageless rows stays exactly as compact as it is now.
export function ImageThumb({ images, size = 34, onClick }: {
  images: StoredImage[]; size?: number; onClick?: () => void;
}) {
  if (!imagesConfigured() || images.length === 0) return null;
  return (
    <img src={thumbUrl(images[0])} alt="" loading="lazy" onClick={onClick}
      title={images.length > 1 ? `${images.length} รูป` : images[0].name}
      style={{ width: size, height: size, objectFit: "cover", borderRadius: "var(--r)",
        border: "1px solid var(--border)", display: "block", cursor: onClick ? "pointer" : "default" }} />
  );
}
