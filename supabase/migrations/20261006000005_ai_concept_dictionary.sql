-- ════════════════════════════════════════════════════════════════════
-- Foundry · AI concept dictionary, version 1 (AI-plan §4, §7, §7.3)
--
-- Areas are the directory's own 167 skills, by NAME ONLY. Their aliases
-- are deliberately not imported: the directory taxonomy lists tools as
-- aliases of areas ("Deep learning" ← pytorch, tensorflow), and importing
-- them would let a broad tag claim a specific tool (§2.1: no reverse
-- inference). Tools, languages, methods and interests are listed here
-- with reviewed exact aliases.
--
-- part_of (tool → area) lets demonstrated PyTorch count towards a Deep
-- Learning criterion, never the other way round. related_to is partial
-- credit for an alternative (PyTorch ~ TensorFlow) and never satisfies an
-- exact requirement. Changing anything here is a new dictionary version
-- and a reason to re-run the evals.
-- ════════════════════════════════════════════════════════════════════

-- ─── Areas, from the directory taxonomy ─────────────────────────────
insert into ai_private.concepts (slug, label, kind, aliases)
select trim(both '-' from regexp_replace(lower(s.name::text), '[^a-z0-9]+', '-', 'g')),
       s.name::text, 'area', array[lower(s.name::text)]
  from public.skills s
on conflict (slug) do nothing;

-- ─── Tools, languages, methods, interests ───────────────────────────
insert into ai_private.concepts (slug, label, kind, aliases, ambiguous) values
  -- Machine learning and data
  ('pytorch',        'PyTorch',          'tool', '{pytorch}', false),
  ('tensorflow',     'TensorFlow',       'tool', '{tensorflow}', false),
  ('keras',          'Keras',            'tool', '{keras}', false),
  ('jax',            'JAX',              'tool', '{jax}', false),
  ('scikit-learn',   'scikit-learn',     'tool', '{scikit-learn,sklearn,"scikit learn"}', false),
  ('xgboost',        'XGBoost',          'tool', '{xgboost}', false),
  ('hugging-face',   'Hugging Face',     'tool', '{"hugging face",huggingface}', false),
  ('langchain',      'LangChain',        'tool', '{langchain}', false),
  ('llamaindex',     'LlamaIndex',       'tool', '{llamaindex,"llama index"}', false),
  ('pandas',         'pandas',           'tool', '{pandas}', false),
  ('numpy',          'NumPy',            'tool', '{numpy}', false),
  ('spark',          'Apache Spark',     'tool', '{"apache spark",pyspark,spark}', true),
  ('hadoop',         'Hadoop',           'tool', '{hadoop}', false),
  ('airflow',        'Airflow',          'tool', '{airflow,"apache airflow"}', false),
  ('dbt',            'dbt',              'tool', '{dbt}', false),
  ('kafka',          'Kafka',            'tool', '{kafka,"apache kafka"}', false),
  ('postgresql',     'PostgreSQL',       'tool', '{postgresql,postgres}', false),
  ('mysql',          'MySQL',            'tool', '{mysql}', false),
  ('mongodb',        'MongoDB',          'tool', '{mongodb,mongo}', false),
  ('redis',          'Redis',            'tool', '{redis}', false),
  ('pgvector',       'pgvector',         'tool', '{pgvector}', false),
  ('elasticsearch',  'Elasticsearch',    'tool', '{elasticsearch}', false),
  ('snowflake',      'Snowflake',        'tool', '{snowflake}', true),
  ('bigquery',       'BigQuery',         'tool', '{bigquery}', false),
  ('tableau',        'Tableau',          'tool', '{tableau}', false),
  ('power-bi',       'Power BI',         'tool', '{"power bi",powerbi}', false),
  ('excel',          'Excel',            'tool', '{excel,"microsoft excel"}', false),
  ('opencv',         'OpenCV',           'tool', '{opencv}', false),
  -- Web, backend, mobile
  ('fastapi',        'FastAPI',          'tool', '{fastapi}', false),
  ('django',         'Django',           'tool', '{django}', false),
  ('flask',          'Flask',            'tool', '{flask}', true),
  ('express',        'Express',          'tool', '{express.js,expressjs}', false),
  ('spring-boot',    'Spring Boot',      'tool', '{"spring boot"}', false),
  ('rails',          'Ruby on Rails',    'tool', '{"ruby on rails",rails}', true),
  ('graphql',        'GraphQL',          'tool', '{graphql}', false),
  ('react',          'React',            'tool', '{react,react.js,reactjs}', false),
  ('nextjs',         'Next.js',          'tool', '{next.js,nextjs}', false),
  ('vue',            'Vue',              'tool', '{vue,vue.js,vuejs}', false),
  ('angular',        'Angular',          'tool', '{angular}', false),
  ('svelte',         'Svelte',           'tool', '{svelte,sveltekit}', false),
  ('tailwind',       'Tailwind CSS',     'tool', '{tailwind,tailwindcss,"tailwind css"}', false),
  ('nodejs',         'Node.js',          'tool', '{node.js,nodejs}', false),
  ('react-native',   'React Native',     'tool', '{"react native"}', false),
  ('flutter',        'Flutter',          'tool', '{flutter}', false),
  ('swiftui',        'SwiftUI',          'tool', '{swiftui}', false),
  -- Infrastructure
  ('docker',         'Docker',           'tool', '{docker}', false),
  ('kubernetes',     'Kubernetes',       'tool', '{kubernetes,k8s}', false),
  ('terraform',      'Terraform',        'tool', '{terraform}', false),
  ('aws',            'AWS',              'tool', '{aws,"amazon web services"}', false),
  ('azure',          'Azure',            'tool', '{azure,"microsoft azure"}', false),
  ('gcp',            'Google Cloud',     'tool', '{gcp,"google cloud","google cloud platform"}', false),
  ('git',            'Git',              'tool', '{git}', false),
  ('github-actions', 'GitHub Actions',   'tool', '{"github actions"}', false),
  ('linux',          'Linux',            'tool', '{linux}', false),
  -- Engineering, hardware, science
  ('ros',            'ROS',              'tool', '{ros,ros2,"robot operating system"}', false),
  ('unity',          'Unity',            'tool', '{unity,unity3d}', true),
  ('unreal-engine',  'Unreal Engine',    'tool', '{"unreal engine",unreal}', false),
  ('blender',        'Blender',          'tool', '{blender}', false),
  ('figma',          'Figma',            'tool', '{figma}', false),
  ('solidity',       'Solidity',         'tool', '{solidity}', false),
  ('matlab',         'MATLAB',           'tool', '{matlab}', false),
  ('simulink',       'Simulink',         'tool', '{simulink}', false),
  ('autocad',        'AutoCAD',          'tool', '{autocad}', false),
  ('solidworks',     'SolidWorks',       'tool', '{solidworks}', false),
  ('ansys',          'ANSYS',            'tool', '{ansys}', false),
  ('comsol',         'COMSOL',           'tool', '{comsol}', false),
  ('labview',        'LabVIEW',          'tool', '{labview}', false),
  ('verilog',        'Verilog',          'tool', '{verilog,systemverilog}', false),
  ('vhdl',           'VHDL',             'tool', '{vhdl}', false),
  ('kicad',          'KiCad',            'tool', '{kicad}', false),
  ('arduino',        'Arduino',          'tool', '{arduino}', false),
  ('raspberry-pi',   'Raspberry Pi',     'tool', '{"raspberry pi"}', false),
  ('spss',           'SPSS',             'tool', '{spss}', false),
  ('stata',          'Stata',            'tool', '{stata}', false),
  -- Business tools
  ('salesforce',     'Salesforce',       'tool', '{salesforce}', false),
  ('hubspot',        'HubSpot',          'tool', '{hubspot}', false),
  ('google-analytics', 'Google Analytics', 'tool', '{"google analytics"}', false),
  ('jira',           'Jira',             'tool', '{jira}', false),
  -- Programming languages
  ('python',         'Python',           'language', '{python}', false),
  ('javascript',     'JavaScript',       'language', '{javascript}', false),
  ('typescript',     'TypeScript',       'language', '{typescript}', false),
  ('java',           'Java',             'language', '{java}', false),
  ('cpp',            'C++',              'language', '{c++,cpp}', false),
  ('csharp',         'C#',               'language', '{c#,csharp}', false),
  ('c-lang',         'C',                'language', '{c}', true),
  ('golang',         'Go',               'language', '{golang,go}', true),
  ('rust',           'Rust',             'language', '{rust}', true),
  ('kotlin',         'Kotlin',           'language', '{kotlin}', false),
  ('swift',          'Swift',            'language', '{swift}', true),
  ('ruby',           'Ruby',             'language', '{ruby}', true),
  ('php',            'PHP',              'language', '{php}', false),
  ('scala',          'Scala',            'language', '{scala}', false),
  ('julia',          'Julia',            'language', '{julia}', true),
  ('haskell',        'Haskell',          'language', '{haskell}', false),
  ('bash',           'Bash',             'language', '{bash,"shell scripting"}', false),
  ('html',           'HTML',             'language', '{html,html5}', false),
  ('css',            'CSS',              'language', '{css,css3}', false),
  ('sql',            'SQL',              'language', '{sql}', false),
  ('dotnet',         '.NET',             'tool',     '{.net,dotnet,asp.net}', false),
  -- Methods
  ('rag',            'RAG',              'method', '{rag,"retrieval-augmented generation","retrieval augmented generation"}', false),
  ('fine-tuning',    'Fine-tuning',      'method', '{fine-tuning,"fine tuning",finetuning}', false),
  ('prompt-engineering', 'Prompt engineering', 'method', '{"prompt engineering"}', false),
  ('llm-agents',     'LLM agents',       'method', '{"ai agents","llm agents","agentic ai"}', false),
  ('cnn',            'Convolutional neural networks', 'method', '{cnn,cnns,"convolutional neural network","convolutional neural networks"}', false),
  ('bayesian-methods', 'Bayesian methods', 'method', '{bayesian,"bayesian statistics","bayesian inference"}', false),
  ('monte-carlo',    'Monte Carlo methods', 'method', '{"monte carlo"}', false),
  ('cfd',            'CFD',              'method', '{cfd,"computational fluid dynamics"}', false),
  ('fea',            'Finite element analysis', 'method', '{fea,"finite element","finite element analysis"}', false),
  ('dcf',            'DCF valuation',    'method', '{dcf,"discounted cash flow"}', false),
  ('lbo',            'LBO modelling',    'method', '{lbo,"leveraged buyout"}', false),
  ('user-interviews', 'User interviews', 'method', '{"user interviews","customer interviews"}', false),
  ('agile',          'Agile',            'method', '{agile,scrum}', false),
  ('tdd',            'Test-driven development', 'method', '{tdd,"test-driven development","test driven development"}', false),
  ('ci-cd',          'CI/CD',            'method', '{ci/cd,cicd,"continuous integration","continuous delivery"}', false),
  ('microservices',  'Microservices',    'method', '{microservices}', false),
  ('etl',            'ETL',              'method', '{etl,elt}', false),
  ('rest-api',       'REST APIs',        'method', '{"rest api","rest apis",restful}', false),
  ('penetration-testing', 'Penetration testing', 'method', '{"penetration testing",pentesting,"pen testing"}', false),
  ('3d-printing',    '3D printing',      'method', '{"3d printing","additive manufacturing"}', false),
  ('cad',            'CAD',              'method', '{cad}', false),
  ('crispr',         'CRISPR',           'method', '{crispr}', false),
  ('pcr',            'PCR',              'method', '{pcr,qpcr}', false),
  ('fpga',           'FPGA design',      'method', '{fpga}', false),
  ('customer-discovery', 'Customer discovery', 'method', '{"customer discovery"}', false),
  ('go-to-market',   'Go-to-market',     'method', '{go-to-market,"go to market"}', false),
  -- Interests
  ('chess',          'Chess',            'interest', '{chess}', false),
  ('football',       'Football',         'interest', '{football,soccer}', false),
  ('basketball',     'Basketball',       'interest', '{basketball}', false),
  ('tennis',         'Tennis',           'interest', '{tennis}', false),
  ('running',        'Running',          'interest', '{running,marathon,marathons}', true),
  ('cycling',        'Cycling',          'interest', '{cycling}', false),
  ('climbing',       'Climbing',         'interest', '{climbing,bouldering}', false),
  ('rowing',         'Rowing',           'interest', '{rowing}', false),
  ('swimming',       'Swimming',         'interest', '{swimming}', false),
  ('hiking',         'Hiking',           'interest', '{hiking}', false),
  ('yoga',           'Yoga',             'interest', '{yoga}', false),
  ('boxing',         'Boxing',           'interest', '{boxing}', false),
  ('martial-arts',   'Martial arts',     'interest', '{"martial arts",karate,judo,"jiu-jitsu","jiu jitsu"}', false),
  ('cricket',        'Cricket',          'interest', '{cricket}', false),
  ('rugby',          'Rugby',            'interest', '{rugby}', false),
  ('music',          'Music',            'interest', '{music}', false),
  ('piano',          'Piano',            'interest', '{piano}', false),
  ('guitar',         'Guitar',           'interest', '{guitar}', false),
  ('singing',        'Singing',          'interest', '{singing,choir}', false),
  ('film',           'Film',             'interest', '{film,films,cinema}', false),
  ('reading',        'Reading',          'interest', '{reading,books}', true),
  ('creative-writing', 'Creative writing', 'interest', '{"creative writing",poetry,fiction}', false),
  ('cooking',        'Cooking',          'interest', '{cooking,baking}', false),
  ('travel',         'Travel',           'interest', '{travel,travelling,traveling}', false),
  ('gaming',         'Gaming',           'interest', '{gaming,"video games"}', false),
  ('board-games',    'Board games',      'interest', '{"board games"}', false),
  ('debating',       'Debating',         'interest', '{debating,debate}', false),
  ('hackathons',     'Hackathons',       'interest', '{hackathon,hackathons}', false),
  ('volunteering',   'Volunteering',     'interest', '{volunteering}', false),
  ('investing',      'Investing',        'interest', '{investing,"stock market"}', false),
  ('sustainability', 'Sustainability',   'interest', '{sustainability}', false),
  ('art',            'Art',              'interest', '{art,painting,drawing}', true),
  ('dance',          'Dance',            'interest', '{dance,dancing}', false),
  ('theatre',        'Theatre',          'interest', '{theatre,theater,drama}', false),
  ('fashion',        'Fashion',          'interest', '{fashion}', false),
  ('podcasts',       'Podcasts',         'interest', '{podcasts,podcasting}', false),
  ('astronomy',      'Astronomy',        'interest', '{astronomy}', false)
on conflict (slug) do nothing;

-- ─── part_of: specific → broad ──────────────────────────────────────
insert into ai_private.concept_relations (from_slug, to_slug, relation, weight)
select r.from_slug, r.to_slug, 'part_of', 1
  from (values
    ('pytorch', 'deep-learning'), ('pytorch', 'machine-learning'),
    ('tensorflow', 'deep-learning'), ('tensorflow', 'machine-learning'),
    ('keras', 'deep-learning'), ('jax', 'deep-learning'), ('cnn', 'deep-learning'),
    ('scikit-learn', 'machine-learning'), ('xgboost', 'machine-learning'), ('fine-tuning', 'machine-learning'),
    ('hugging-face', 'natural-language-processing'), ('hugging-face', 'large-language-models'),
    ('langchain', 'large-language-models'), ('llamaindex', 'large-language-models'), ('rag', 'large-language-models'),
    ('prompt-engineering', 'large-language-models'), ('llm-agents', 'large-language-models'),
    ('pandas', 'data-science'), ('numpy', 'data-science'),
    ('spark', 'data-engineering'), ('hadoop', 'data-engineering'), ('airflow', 'data-engineering'),
    ('dbt', 'data-engineering'), ('kafka', 'data-engineering'), ('kafka', 'distributed-systems'),
    ('etl', 'data-engineering'), ('snowflake', 'data-engineering'), ('bigquery', 'data-engineering'),
    ('postgresql', 'database-engineering'), ('mysql', 'database-engineering'), ('mongodb', 'database-engineering'),
    ('redis', 'database-engineering'), ('pgvector', 'database-engineering'), ('elasticsearch', 'database-engineering'),
    ('sql', 'database-engineering'),
    ('tableau', 'data-visualization'), ('tableau', 'business-intelligence'), ('power-bi', 'business-intelligence'),
    ('opencv', 'computer-vision'), ('cnn', 'computer-vision'),
    ('fastapi', 'backend-development'), ('django', 'backend-development'), ('flask', 'backend-development'),
    ('express', 'backend-development'), ('spring-boot', 'backend-development'), ('rails', 'backend-development'),
    ('nodejs', 'backend-development'), ('dotnet', 'backend-development'), ('golang', 'backend-development'),
    ('java', 'backend-development'),
    ('graphql', 'api-design'), ('rest-api', 'api-design'),
    ('react', 'frontend-development'), ('nextjs', 'frontend-development'), ('nextjs', 'full-stack-dev'),
    ('vue', 'frontend-development'), ('angular', 'frontend-development'), ('svelte', 'frontend-development'),
    ('tailwind', 'frontend-development'), ('html', 'frontend-development'), ('css', 'frontend-development'),
    ('javascript', 'web-development'), ('typescript', 'web-development'), ('php', 'web-development'),
    ('react-native', 'mobile-development'), ('flutter', 'mobile-development'), ('swiftui', 'mobile-development'),
    ('swift', 'mobile-development'), ('kotlin', 'mobile-development'),
    ('docker', 'devops'), ('kubernetes', 'devops'), ('kubernetes', 'cloud-engineering'), ('terraform', 'devops'),
    ('terraform', 'cloud-engineering'), ('github-actions', 'devops'), ('ci-cd', 'devops'), ('linux', 'devops'),
    ('aws', 'cloud-engineering'), ('azure', 'cloud-engineering'), ('gcp', 'cloud-engineering'),
    ('microservices', 'software-architecture'), ('microservices', 'distributed-systems'),
    ('ros', 'robotics-software'), ('unity', 'game-development'), ('unreal-engine', 'game-development'),
    ('blender', '3d-modelling-animation'), ('figma', 'ui-design'), ('figma', 'product-design'),
    ('solidity', 'blockchain-web3'), ('matlab', 'applied-mathematics'), ('simulink', 'systems-engineering'),
    ('autocad', 'civil-engineering'), ('solidworks', 'mechanical-engineering'), ('cad', 'mechanical-engineering'),
    ('fea', 'mechanical-engineering'), ('ansys', 'simulation-modelling'), ('comsol', 'simulation-modelling'),
    ('monte-carlo', 'simulation-modelling'), ('cfd', 'fluid-dynamics'), ('labview', 'instrumentation'),
    ('verilog', 'semiconductor-design'), ('vhdl', 'semiconductor-design'), ('fpga', 'electronics-design'),
    ('kicad', 'electronics-design'), ('arduino', 'embedded-systems'), ('raspberry-pi', 'embedded-systems'),
    ('c-lang', 'embedded-systems'), ('c-lang', 'systems-programming'), ('cpp', 'systems-programming'),
    ('rust', 'systems-programming'), ('crispr', 'synthetic-biology'), ('crispr', 'molecular-biology'),
    ('pcr', 'molecular-biology'), ('spss', 'statistics'), ('stata', 'statistics'), ('stata', 'economics'),
    ('bayesian-methods', 'statistics'), ('python', 'python-programming'), ('bash', 'automation-scripting'),
    ('penetration-testing', 'cybersecurity'), ('3d-printing', 'manufacturing-prototyping'),
    ('dcf', 'financial-modelling'), ('lbo', 'private-equity'), ('user-interviews', 'user-research'),
    ('tdd', 'quality-assurance'), ('agile', 'project-management'), ('jira', 'project-management'),
    ('salesforce', 'sales'), ('hubspot', 'marketing'), ('google-analytics', 'growth'),
    ('customer-discovery', 'product'), ('go-to-market', 'sales-gtm')
  ) as r(from_slug, to_slug)
 where exists (select 1 from ai_private.concepts c where c.slug = r.from_slug)
   and exists (select 1 from ai_private.concepts c where c.slug = r.to_slug)
on conflict do nothing;

-- ─── related_to: alternatives, stored both ways ─────────────────────
insert into ai_private.concept_relations (from_slug, to_slug, relation, weight)
select d.f, d.t, 'related_to', x.w
  from (values
    ('pytorch', 'tensorflow', 0.5), ('pytorch', 'keras', 0.5), ('tensorflow', 'keras', 0.5), ('pytorch', 'jax', 0.5),
    ('react', 'vue', 0.5), ('react', 'angular', 0.5), ('vue', 'angular', 0.5), ('react', 'svelte', 0.5),
    ('fastapi', 'flask', 0.5), ('fastapi', 'django', 0.5), ('flask', 'django', 0.5),
    ('postgresql', 'mysql', 0.5), ('aws', 'azure', 0.5), ('aws', 'gcp', 0.5), ('azure', 'gcp', 0.5),
    ('java', 'kotlin', 0.5), ('java', 'csharp', 0.5), ('cpp', 'c-lang', 0.5), ('cpp', 'rust', 0.5),
    ('javascript', 'typescript', 0.8), ('tableau', 'power-bi', 0.5), ('spark', 'hadoop', 0.5),
    ('solidworks', 'autocad', 0.5), ('verilog', 'vhdl', 0.5), ('react-native', 'flutter', 0.5),
    ('swift', 'kotlin', 0.5), ('langchain', 'llamaindex', 0.5), ('spss', 'stata', 0.5)
  ) as x(a, b, w)
 cross join lateral (values (x.a, x.b), (x.b, x.a)) as d(f, t)
 where exists (select 1 from ai_private.concepts c where c.slug = d.f)
   and exists (select 1 from ai_private.concepts c where c.slug = d.t)
on conflict do nothing;
