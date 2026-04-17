from database import engine, Base
import models  # important: registers all model tables

if __name__ == "__main__":
    Base.metadata.create_all(bind=engine)
    print("PostgreSQL tables created successfully.")