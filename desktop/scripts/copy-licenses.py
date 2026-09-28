from importlib.metadata import distributions
from pathlib import Path
from shutil import copy2

target = Path('stage/runtime/pdf/_internal/licenses')
for distribution in distributions():
    for file in distribution.files or []:
        if any(word in file.name.lower() for word in ['license', 'copying', 'notice', 'copyright']):
            source = distribution.locate_file(file)
            if source.is_file():
                destination = target / distribution.metadata['Name'] / str(file).replace('../', '')
                destination.parent.mkdir(parents=True, exist_ok=True)
                copy2(source, destination)
