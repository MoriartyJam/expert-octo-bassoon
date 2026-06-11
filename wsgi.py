from __future__ import annotations

import os
import sys
from pathlib import Path


ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT / "src"))

from yardnav.app import create_app


app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "80"))
    app.run(host="0.0.0.0", port=port, threaded=False)
