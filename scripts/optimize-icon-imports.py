"""Import only used Phosphor icons, keeping development and type checks lightweight."""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1] / "apps" / "web" / "src"
pattern = re.compile(r"import\s+\{([^}]+)\}\s+from\s+['\"]@phosphor-icons/react['\"]")

def replace(match):
    imports = []
    for value in match.group(1).split(","):
        name = value.strip()
        if not name:
            continue
        original = name.split(" as ")[0]
        source = "@phosphor-icons/react/dist/lib/context" if original == "IconContext" else f"@phosphor-icons/react/dist/csr/{original}"
        imports.append(f"import {{ {name} }} from '{source}'")
    return "\n".join(imports)

for path in root.rglob("*.tsx"):
    text = path.read_text(encoding="utf-8")
    result = pattern.sub(replace, text)
    if result != text:
        path.write_text(result, encoding="utf-8")
print("Phosphor imports now resolve only the icons used by each component.")
