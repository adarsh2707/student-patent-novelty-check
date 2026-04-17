from sentence_transformers import SentenceTransformer

print("Downloading model...")
model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

model.save("models/all-MiniLM-L6-v2")

print("✅ Model saved to models/all-MiniLM-L6-v2")