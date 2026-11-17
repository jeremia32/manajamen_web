from __future__ import annotations

from backend.main import get_embeddings, get_supabase

BATCH_SIZE = 16


def main() -> None:
    supabase = get_supabase()
    embeddings = get_embeddings("huggingface")
    offset = 0
    processed = 0

    while True:
        rows = (
            supabase.table("document_chunks")
            .select("id, content")
            .order("id")
            .range(offset, offset + BATCH_SIZE - 1)
            .execute()
            .data
            or []
        )
        if not rows:
            break

        vectors = embeddings.embed_documents([row["content"] for row in rows])
        payload = [
            {"id": row["id"], "embedding": vector}
            for row, vector in zip(rows, vectors, strict=True)
        ]
        result = supabase.rpc(
            "update_document_chunk_embeddings",
            {"p_items": payload},
        ).execute()
        updated_count = int(result.data or 0)
        if updated_count != len(rows):
            raise RuntimeError(
                f"Expected to update {len(rows)} chunks but Supabase updated {updated_count}. "
                "Check the schema and rerun the script."
            )

        processed += updated_count
        offset += len(rows)
        print(f"Embedded {processed} document chunks.")

    if processed == 0:
        print("No document chunks found; nothing to re-embed.")
    else:
        print(f"Re-embedding complete: {processed} chunks updated.")


if __name__ == "__main__":
    main()
