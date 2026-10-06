# Lanzador de Manim para Lumen: el Python portable ignora PYTHONPATH, así que añade la carpeta de Manim
# (LUMEN_MANIM_LIB o .tools/manim-lib) y el directorio de la escena (para importar kit/ y components/).
import os, runpy, sys
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.environ.get('LUMEN_MANIM_LIB') or os.path.join(root, '.tools', 'manim-lib'))
sys.path.insert(0, os.getcwd())
sys.argv[0] = 'manim'
runpy.run_module('manim', run_name='__main__', alter_sys=True)
