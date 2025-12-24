# Configuration file for the Sphinx documentation builder.
# https://www.sphinx-doc.org/en/master/usage/configuration.html

# -- Project information -----------------------------------------------------
project = 'Lankir'
copyright = '2025, Lankir Contributors'
author = 'Lankir Contributors'
version = '0.1'
release = '0.1.1'

# -- General configuration ---------------------------------------------------
extensions = [
    'sphinx.ext.autodoc',
    'sphinx.ext.viewcode',
    'sphinx.ext.napoleon',
    'sphinx.ext.intersphinx',
    'sphinx_copybutton',
    'sphinx_design',
    'myst_parser',
]

templates_path = ['_templates']
exclude_patterns = ['_build', 'Thumbs.db', '.DS_Store', 'README.md']

# -- Options for HTML output -------------------------------------------------
html_theme = 'sphinx_rtd_theme'
html_static_path = ['_static']
html_logo = '_static/logo.png'
html_favicon = '_static/favicon.ico'
html_title = 'Lankir Documentation'

html_theme_options = {
    'logo_only': False,
    'display_version': True,
    'prev_next_buttons_location': 'bottom',
    'style_external_links': True,
    'collapse_navigation': False,
    'sticky_navigation': True,
    'navigation_depth': 4,
    'includehidden': True,
    'titles_only': False,
}

html_context = {
    'display_github': True,
    'github_user': 'Matbe34',
    'github_repo': 'lankir',
    'github_version': 'main',
    'conf_py_path': '/docs/',
}

# -- MyST Parser configuration -----------------------------------------------
myst_enable_extensions = [
    'colon_fence',
    'deflist',
    'tasklist',
    'fieldlist',
    'attrs_inline',
    'attrs_block',
]
myst_heading_anchors = 3

# -- Intersphinx configuration -----------------------------------------------
intersphinx_mapping = {
    'python': ('https://docs.python.org/3', None),
}

# -- Source file configuration -----------------------------------------------
source_suffix = {
    '.rst': 'restructuredtext',
    '.md': 'markdown',
}

# -- Pygments syntax highlighting --------------------------------------------
pygments_style = 'monokai'
pygments_dark_style = 'monokai'

# -- Copy button configuration -----------------------------------------------
copybutton_prompt_text = r'>>> |\.\.\. |\$ |> '
copybutton_prompt_is_regexp = True

# -- Custom CSS --------------------------------------------------------------
def setup(app):
    app.add_css_file('custom.css')
