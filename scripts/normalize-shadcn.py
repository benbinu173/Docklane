"""Keep generated UI components aligned with Docklane's aliases and icon family."""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
web = root / "apps" / "web"
source = web / "@" / "components" / "ui"
destination = web / "src" / "components" / "ui"
destination.mkdir(parents=True, exist_ok=True)
icon_map = {
    "XIcon": "X", "CheckIcon": "Check", "ChevronRightIcon": "CaretRight",
    "ChevronDownIcon": "CaretDown", "ChevronUpIcon": "CaretUp", "CircleIcon": "Circle",
}

def normalize(text):
    text = text.replace('from "cn"', 'from "@/lib/utils"')
    def icons(match):
        names = [name.strip() for name in match.group(1).split(",")]
        return "import { " + ", ".join(f"{icon_map[name]} as {name}" for name in names) + ' } from "@phosphor-icons/react"'
    return re.sub(r'import \{ ([^}]+) \} from "lucide-react"', icons, text)

if source.exists():
    for path in source.glob("*.tsx"):
        target = destination / path.name
        assert path.resolve().is_relative_to(root.resolve())
        assert target.resolve().is_relative_to(root.resolve())
        assert not target.exists(), f"Refusing to overwrite {target}"
        target.write_text(normalize(path.read_text(encoding="utf-8")), encoding="utf-8")
        path.unlink()
    # Remove only known empty directories created by the CLI's alias fallback.
    for directory in [source, source.parent, source.parent.parent]:
        if directory.exists() and not any(directory.iterdir()):
            directory.rmdir()
else:
    for path in destination.glob("*.tsx"):
        path.write_text(normalize(path.read_text(encoding="utf-8")), encoding="utf-8")
print("UI aliases normalized; all component icons use Phosphor.")
