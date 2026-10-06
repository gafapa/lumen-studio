# Guardián de las escenas Manim: análisis del árbol sintáctico antes de ejecutar nada. Manim es Python sin el
# aislamiento de un navegador, así que solo se permiten importaciones matemáticas y de Manim, y se bloquean
# archivos, sistema, red, ejecución dinámica, introspección y escritura. Salida: JSON con los problemas.
import ast, json, sys

ALLOWED_IMPORTS = {'manim', 'numpy', 'math', 'random', 'itertools', 'functools', 'colorsys', 'typing', 'dataclasses', 'enum', 'string', 'fractions', 'decimal', 'statistics', 'collections', 'operator', '__future__', 'kit', 'components', 'lumen'}
BLOCKED_NAMES = {'open', 'exec', 'eval', 'compile', '__import__', 'globals', 'locals', 'vars', 'getattr', 'setattr', 'delattr', 'input', 'breakpoint', 'exit', 'quit', 'help', 'memoryview', 'object', 'type', 'super_import'}
BLOCKED_ATTRIBUTES = {'save', 'write', 'write_text', 'write_bytes', 'unlink', 'remove', 'rmdir', 'mkdir', 'makedirs', 'rename', 'replace', 'system', 'popen', 'spawn', 'file_writer', 'tofile', 'savetxt', 'savez', 'load', 'loadtxt', 'fromfile', 'frombuffer', 'ctypeslib', 'lib', 'testing', 'distutils', 'f2py'}
LATEX_CLASSES = {'MathTex', 'Tex', 'SingleStringMathTex', 'Matrix', 'IntegerMatrix', 'DecimalMatrix', 'MobjectMatrix', 'BulletedList', 'Title', 'Variable', 'BraceLabel', 'BraceText'}

def check(path, has_latex):
    source = open(path, encoding='utf-8').read()
    issues = []
    def add(node, rule, message, severity='error'):
        issues.append({'file': path.replace('\\', '/').split('/')[-1], 'line': getattr(node, 'lineno', 1), 'rule': rule, 'severity': severity, 'message': message})
    try:
        tree = ast.parse(source, filename=path)
    except SyntaxError as error:
        return [{'file': path.replace('\\', '/').split('/')[-1], 'line': error.lineno or 1, 'rule': 'syntax', 'severity': 'error', 'message': f'Error de sintaxis: {error.msg}'}]
    uses_random = False
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split('.')[0]
                if root not in ALLOWED_IMPORTS: add(node, 'import', f'Importación no permitida: {alias.name}. Solo manim, numpy y módulos matemáticos.')
                if root == 'random': uses_random = True
        elif isinstance(node, ast.ImportFrom):
            root = (node.module or '').split('.')[0]
            if node.level == 0 and root not in ALLOWED_IMPORTS: add(node, 'import', f'Importación no permitida: {node.module}.')
            if root == 'random': uses_random = True
        elif isinstance(node, ast.Name) and node.id in BLOCKED_NAMES:
            add(node, 'builtin', f'No se permite usar {node.id} en una escena.')
        elif isinstance(node, ast.Attribute):
            if node.attr.startswith('__') and node.attr.endswith('__'): add(node, 'dunder', f'No se permite acceder a {node.attr}.')
            elif node.attr in BLOCKED_ATTRIBUTES: add(node, 'io', f'No se permite {node.attr}: la escena no puede escribir ni cargar archivos por su cuenta.')
            elif node.attr in {'config'} and isinstance(node.ctx, ast.Store): add(node, 'config', 'No cambies la configuración global de Manim.')
        elif isinstance(node, ast.Name) and node.id == 'config' and isinstance(node.ctx, ast.Store):
            add(node, 'config', 'No cambies la configuración global de Manim.')
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in LATEX_CLASSES and not has_latex:
            add(node, 'latex', f'{node.func.id} necesita LaTeX, que no está instalado: usa Text o MarkupText (y DecimalNumber(..., mob_class=Text)).')
    if uses_random and 'seed(' not in source:
        issues.append({'file': path.replace('\\', '/').split('/')[-1], 'line': 1, 'rule': 'nondeterministic', 'severity': 'error', 'message': 'Si usas random, fija la semilla (random.seed(...)) para que el render sea determinista.'})
    return issues

if __name__ == '__main__':
    has_latex = sys.argv[1] == '1'
    result = []
    for file in sys.argv[2:]: result.extend(check(file, has_latex))
    print(json.dumps(result, ensure_ascii=False))
