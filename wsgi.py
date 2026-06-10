from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT / "src"))

from yardnav.app import create_app


app = create_app()
