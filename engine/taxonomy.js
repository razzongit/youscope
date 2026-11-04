/* YouScope — taxonomy.js
 * Interest taxonomy: categories → { channels (exact/substring match), keywords (title match) }
 * Runs in browser and Node. Deterministic, offline, no API needed.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YSTaxonomy = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CATEGORIES = [
    {
      id: 'music-punjabi', label: 'Punjabi & Hindi Music', color: '#f06292',
      channels: ['Diljit Dosanjh', 'Karan Aujla', 'Shubh', 'AP Dhillon', 'Sidhu Moose Wala',
        'Mitraz', 'Seedhe Maut', 'Raftaar', 'Guru Randhawa', 'Harnoor', 'Renuka Panwar',
        'Vishal Mishra', 'Arijit Singh', 'Pritam', 'T-Series', 'Saregama Music', 'Zee Music',
        'Sony Music India', 'JioStudios', 'Speed Records', 'White Hill Music', 'Tip Music',
        'Hasan Raheem', 'Talha Anjum', 'Talhah Yunus', 'Young Stunners', 'Abdul Hannan', 'Talwiinder', 'Kalamkaar', 'Chaar Diwaari',
        'Kaifi Khalil', 'Coke Studio', 'Coke Studio Bharat', 'MTV Unplugged'],
      match: 'contains',
    },
    {
      id: 'music-global', label: 'Global Music', color: '#ba68c8',
      channels: ['Sabrina Carpenter', 'Kendrick Lamar', 'Adele', 'Taylor Swift', 'Drake',
        'The Weeknd', 'Billie Eilish', 'Dua Lipa', 'Eminem', 'Travis Scott', 'SZA',
        'Coldplay', 'Imagine Dragons', 'OneRepublic', 'Ed Sheeran', 'Bruno Mars',
        'Michael Jackson', 'Queen', 'Linkin Park', 'J. Cole', '21 Savage', 'Playboi Carti',
        'Travis', 'XXXTENTACION', 'Juice WRLD', 'Lil Baby', 'Central Cee', 'Dave',
        'Stormzy', 'A$AP Rocky', 'Frank Ocean', 'Tyler The Creator', 'Doja Cat',
        'Olivia Rodrigo', 'Ariana Grande', 'Selena Gomez', 'Miley Cyrus', 'Shakira',
        'BTS', 'BLACKPINK', 'NewJeans', 'Kiss of Life'],
      match: 'contains',
    },
    {
      id: 'fitness-health', label: 'Fitness & Health', color: '#ff8a65',
      channels: ['Jeff Nippard', 'Renaissance Periodization', 'MIND WITH MUSCLE', 'Mind With Muscle',
        'The Barbell path', 'The Barbell Path', 'House Of Hypertrophy', 'Sean Nalewanyj',
        'PictureFit', 'ATHLEAN-X', 'Athlean-X', 'Deepak Thakran Fitness', 'Garage Gym Reviews',
        'FitnessFAQs', 'More Plates More Dates', 'Shredded Sports Science', 'Rajveer Fitness',
        'Yash Sharma Fitness', 'Fit Tuber', 'Guru Mann Fitness', 'MY BOLLYBODY',
        'Jeet Selal Aesthetics', 'Yatinder Singh', 'Suneet Sharma', 'Kabir Singh',
        'Andrew Kwong', 'DeltaBolic', 'Dr Pal', 'PowerTrain By Aakash Bhavsar',
        'Vitality Wellness Hub', 'alibeingfit'],
      keywords: ['workout', 'hypertrophy', 'progressive overload', 'muscle building',
        'deadlift', 'bench press', 'pushup', 'push up', 'gym ', 'six pack', 'biceps',
        'triceps', 'shredded', 'bulking', 'creatine', 'delt', 'lat spread', 'protein intake',
        'pr personal record', 'flexing', 'bodybuilding', 'deadhang', 'pull up', 'pullup',
        'face pull', 'lateral raise', 'leg day', 'arm day', 'back day', 'science of'],
    },
    {
      id: 'finance-startups', label: 'Finance & Startups', color: '#ffd54f',
      channels: ['Labour Law Advisor', 'Nikhil Kamath', 'Backstage with Millionaires',
        'Raj Shamani', 'Figuring Out', 'The 1% Club', 'SoIC', 'Pranjal Kamra',
        'CA Rachana Ranade', 'Finance with Sharan', 'Labour Law Advisor Shorts',
        'GrowthX', 'Think School', 'Storebuyouts', 'Vivek Bindra', 'Kunal Shah',
        'Indian Startup News', 'Startup Screen', 'Aevy TV', 'Frontier Heroes',
        'wtfund', 'Zero to One', 'Y Combinator', 'Y Combinator Shorts', 'Trustified', 'Shark Tank India'],
      keywords: ['startup', 'funding', 'stock market', 'investing', 'mutual fund',
        'personal finance', 'income tax', 'gst ', 'trading', 'cryptocurrency', 'mutual fund sip',
        'business model', 'case study', 'economy', 'ipo ', 'recession', 'valuation'],
    },
    {
      id: 'tech-gadgets', label: 'Tech & Gadgets', color: '#4fc3f7',
      channels: ['TechWiser', 'Beebom', 'Mrwhosetheboss', 'Marques Brownlee', 'Tech Bar',
        'Tech Altar', 'Dave2D', 'Linus Tech Tips', 'Casetify', 'Nothing',
        'TechBurner', 'Technical Guruji', 'Geekyranjit', 'Techno Ruhez', 'SMACK TECH',
        'AppleDsign', 'mryeester', 'Mrkeybrd', 'In The Air & Dropped', 'TechDroider',
        'Aura Tech', 'Hydraulic Press Channel', 'DIY Perks', 'Mashable India', 'Jay Kapoor'],
      keywords: ['smartphone', 'iphone', 'android', 'macbook', 'airpods', 'gadget',
        'unboxing', 'review', 'nothing phone', 'oneplus', 'samsung galaxy', 'pixel ',
        'smartwatch', 'wireless earbuds', 'gaming laptop', 'nvme', 'ssd', 'gpu',
        'rtx ', 'graphics card', 'keyboard', 'mechanical keyboard', 'custom pc', 'pc build'],
    },
    {
      id: 'programming', label: 'Programming & Web Dev', color: '#26a69a',
      channels: ['SuperSimpleDev', 'LearnCodez', 'The PrimeTime', 'Code Bootcamp', 'WsCube Tech',
        'Fireship', 'Web Dev Simplified', 'Traversy Media', 'freeCodeCamp', 'The Net Ninja',
        'Kevin Stratvert', 'NetworkChuck', 'CS50', 'Academind', 'Programming with Mosh',
        'CodeWithHarry', 'Hitesh Choudhary', 'Chai aur Code', 'Apna College',
        'College Wallah', 'Kevin Powell', 'Mehul Mohan', 'Thapa Technical',
        'The Primeagen', 'Theo - t3', 'Programming With Mosh', 'Bro Code',
        'CodeWithAntonio', 'Tailwind Labs', 'JavaScript Mastery', 'Codevolution',
        'Sonny Sangha', 'Dave Gray Teaches Code', 'Blender Guru'],
      keywords: ['javascript', 'python', 'react js', 'reactjs', 'next.js', 'node.js', 'typescript',
        'html', 'css', 'tailwind', 'programming', 'coding', 'web dev', 'web development',
        'react js', 'reactjs', 'react tutorial', 'react hook', 'react native',
        'rust ', ' golang', 'laravel', 'django', 'flutter', 'rest api', 'git ', 'github',
        'vs code', 'vscode', 'algorithm', 'data structure', 'leetcode', 'dsa ',
        'full stack', 'frontend', 'backend', 'sql', 'mongodb', 'linux', 'terminal',
        'landing page', 'side project', 'open source', 'vibe coding', 'cursor ',
        'linus torvalds', 'c++', 'java ', '#shorts #coding', 'developer', 'software engineer'],
    },
    {
      id: 'ai-tech', label: 'AI & Machine Learning', color: '#b39ddb',
      channels: ['Two Minute Papers', 'Yannic Kilcher', '3Blue1Brown', 'Andrej Karpathy',
        'AI Explained', 'Matt Wolfe', 'IBM Technology', 'DeepLearning.AI', 'Krish Naik',
        'CodeBasics', 'SphereThoughts', 'Machine Learning Street Talk', 'AI Search',
        'Utkarsh Kushwaha', 'Wes Rchner', 'Data School', 'Ken Jee', 'Fireship',
        'ByCloud', 'AI Foundations'],
      keywords: ['artificial intelligence', ' ai ', 'machine learning', 'deep learning',
        'neural network', 'llm', 'large language model', 'chatgpt', 'gpt-4', 'gpt 4',
        'openai', 'claude', 'gemini', 'midjourney', 'stable diffusion', 'neural',
        'transformer', 'gpt', 'ai agent', 'deepseek', 'llama', 'neuralink',
        'ai is', 'this ai', ' ai?', 'ai tool', 'vibe coding'],
    },
    {
      id: 'science-curiosity', label: 'Science & Curiosity', color: '#81c784',
      channels: ['Veritasium', 'SmarterEveryDay', 'Kurzgesagt', 'Vsauce', 'Steve Mould',
        'Physics Girl', 'ElectroBOOM', 'Applied Science', 'Action Lab', 'Branch Education',
        'Real Engineering', 'Real Science', 'Lesics', 'The Efficient Engineer',
        'Practical Engineering', 'Science and fun', 'science to technology',
        'Sufiyan Alam', 'Mr Scientific', 'Cleo Abram', 'Seeker', 'MinutePhysics',
        'Cool Worlds', 'Anton Petrov', 'SciShow', 'Hot Ones', 'MR.DEEPRAJ',
        'In a Nutshell', 'What If', 'Underworld', 'UrDay', 'The Curious Cobra', 'Planet In Pixel', 'FloatHeadPhysics', 'Zack D. Films', 'India in Pixels', 'GYRUS SULCUS', 'The Rest Is Science', 'Unravelled by Shankar', 'ExplainingComputers'],
      keywords: ['how does', 'how do', 'why does', 'why do', 'science', 'physics',
        'quantum', 'outer space', 'nasa', 'universe', 'black hole', 'mars', 'spacex',
        'rocket', 'theory of relativity', 'evolution', 'biology', 'chemistry',
        'astronomy', 'telescope', 'dna', 'brain ', 'psychology', 'experiment',
        'explained', 'documentary', 'what happens if', 'what if'],
    },
    {
      id: 'podcasts-talks', label: 'Podcasts & Long-form', color: '#90a4ae',
      channels: ['Prakhar Gupta', 'Varun Mayya', 'Ranveer Allahbadia', 'BeerBiceps',
        'Dostcast', 'The Ranveer Show', 'TRS ', 'Aevy TV', 'Shashank Sharma',
        'Aashish Solanki', 'Pretty Good Roast Show', 'MensXP', 'The Viral Fever',
        'Netflix India', 'Prime Video India', 'JioStudios', 'Sillycorns', '2 Sloggers',
        'Chase Masters', 'Wondershare', 'In The Air & Dropped', 'ezExplains',
        'The Deshbhakt', 'Dhruv Rathee', 'Jist', 'Aapka Jags', 'Neeraj Walia',
        'Gyan Therapy', 'Sagar\'s Kitchen', 'Kunal Shah', 'Vaad',
        'Backstage with Millionaires', 'Figuring Out', 'The Lallantop',
        'Unfiltered by Samdish', 'Ronnie Coleman', 'Nirmal Pillai', 'Madan Gowri',
        ' Krishnamurthy', 'Awakening with Brahma', 'Sadhguru', 'Jay Shetty', 'Untriggered with AminJaz', 'Vimoh', 'Kaustubh Agarwal', 'Mohak Mangal', 'Akshay Dixit', 'Radical Living', 'Vedant Rusty', 'Sid The IT Guy', 'Lastly', 'TylerPath', 'Gangsta Perspectives'],
      keywords: ['podcast', 'interview', 'full episode', 'talks about',
        'conversation with', 'in depth', 'documentary', ' roast', 'stand up',
        'standup', 'comedy', 'satire', 'political', 'geopolitics', 'election',
        'modi', 'rahul gandhi', 'bjp', 'congress', 'india news'],
    },
    {
      id: 'food-cooking', label: 'Food & Cooking', color: '#ffb74d',
      channels: ['Way Too Hungry', 'Food Pharmer', 'Chef Ranveer Brar', 'Saransh Goila',
        'Sagar\'s Kitchen', 'Gordon Ramsay', 'Babish Culinary Universe', 'Mark Wiens',
        'Best Ever Food Review Show', 'Strictly Dumpling', 'The Food Ranger',
        'Kabita\'s Kitchen', 'Your Food Lab', 'NishaMadhulika', 'Hebbar\'s Kitchen',
        'Village Cooking Channel', 'Grandpa Kitchen', 'Mouthwatering Vegan',
        'Johnny Drinks', 'fromevel', 'Glen And Friends Cooking', 'Alex',
        'Kenji Lopez-Alt', 'Maangchi', 'Binge With Babish', 'Mix it up with Mendi', 'Nikhil Chawla', 'Great Indian Asmr', 'Chef Neha Deepak Shah', 'Rojas Recipes', 'The Happy High Bartending Academy'],
      keywords: ['recipe', 'cooking', ' street food', 'mukbang', 'eating challenge',
        'chef', 'kitchen', 'baking', 'cake', 'pizza', 'burger', 'biryani', 'paneer',
        'chicken ', ' cook', 'tasty', 'snack', 'dessert', 'chocolate', 'ice cream',
        'curry', 'dinner', 'lunch', 'breakfast', 'vegetarian', 'vegan ', 'foodie',
        'restaurant', 'taste test', 'food review'],
    },
    {
      id: 'gaming', label: 'Gaming', color: '#7e57c2',
      channels: ['Techno Gamerz', 'Total Gaming', 'AjjuBhai', 'CarryMinati', 'Mortal',
        'ScoutOP', 'Mama\'s Gaming', 'BeastBoyShub', 'Slayy Point', 'GamerFleet',
        'RawKnee Games', 'Triggered Insaan', 'Kunal Sekhon', 'Noble', 'GTA',
        'Mr Beast Gaming', 'Dream', 'TommyInnit', 'Markiplier', 'Jacksepticeye'],
      keywords: ['gta ', 'gta 5', 'gta v', 'gta 6', 'minecraft', 'valorant',
        'bgmi', 'pubg', 'free fire', 'gameplay', 'gaming', 'speedrun', 'rpg ',
        'fps game', 'playthrough', 'walkthrough', 'stream highlights', 'live stream',
        'game ', 'boss fight', 'no scope', 'clutch play', 'fortnite', 'call of duty',
        'csgo', 'cs2', 'elden ring', 'zelda', 'mario', 'fifa ', 'efootball'],
    },
    {
      id: 'cars-auto', label: 'Automotive', color: '#e57373',
      channels: ['The Rev Room', 'PowerDrift', 'Autocar India', 'Overdrive',
        'Cartoq', 'RSM MotorSport', 'P9 Motoring', 'Kapaver', 'Gadget Adda',
        'Ralston D', 'Aakash Jaiswal', 'Nikhil Rana', 'Turbo Labs'],
      keywords: ['car ', 'cars', 'bike ', 'scooty', 'scooter', 'motorcycle', 'royal enfield',
        'activa', ' Tata', 'mahindra', 'maruti', 'hyundai', ' kia ', 'suv ', 'xuv',
        'thar', 'fortuner', 'maruti swift', 'baleno', 'altroz', 'nexon', 'mileage',
        'test drive', 'car review', 'auto expo', 'engine', 'diesel', 'petrol',
        'electric vehicle', 'electric car', 'supercar', 'supercars', 'drag race', 'car drift'],
    },
    {
      id: 'self-improvement', label: 'Self-improvement & Mindset', color: '#aed581',
      channels: ['Gyan Therapy', 'Hamza', 'Hamza Ahmed', 'Improvement Pill',
        'Better Ideas', 'Better Than Yesterday', 'Pursuit of Wonder', 'Einzelgänger',
        'Absolute Motivation', 'Motivation Madness', 'Ben Lionel Scott', 'Mindset',
        'Chris Williamson', 'Modern Wisdom', 'Huberman Lab', 'Andrew Huberman',
        'Jay Shetty', 'Thoraya', 'Psych2Go', 'Charisma on Command', 'Social Animal'],
      keywords: ['self improvement', 'discipline', 'motivation', 'mindset', 'stoicism',
        'stoic', 'habits', 'dopamine', 'focus ', 'productivity', 'meditation',
        'confidence', 'social skills', 'charisma', 'anxiety', 'overthinking',
        'mental health', 'therapy', 'psychology', ' attachment', 'green flags',
        'red flags', 'masculinity', 'self love', 'glow up', 'life lessons',
        'sadhguru', 'spirituality', 'law of attraction'],
    },
    {
      id: 'comedy-entertainment', label: 'Comedy & Entertainment', color: '#ff8a80',
      channels: ['Aashish Solanki', '2 Sloggers', 'MensXP', 'The Viral Fever',
        'Sillycorns', 'Aevy TV', 'Netflix India', 'Prime Video India', 'JioStudios',
        'Aapka Jags', 'Nirmal Pillai', 'Raghav Anand', 'Madhur Virli', 'Vaad',
        'Triggered Insaan', 'Slayy Point', 'RoundTable Invent', 'Indian meme',
        'Abbott and Costello', 'Omkar Kadam', 'Kenath Ramdas', 'Kumari Kuch Bhi',
        'Gaurav Kapoor', 'Anubhav Singh Bassi', 'Zakir Khan', 'Rahul Dua',
        'Harsh Gujral', 'Anubhav Singh Bassi', 'Kenny Sebastian', 'Kanan Gill',
        'Biswa Kalyan Rath', 'Sumukhi Suresh', 'Abish Mathew', 'Samay Raina', 'Tanmay Bhat', 'Gursimran Khamba', 'The Screen Patti', 'Shubham Gaur', 'Justin Flom', 'India\'s Got Latent Clips', 'Dank Rishu', 'Kriss K3B'],
      keywords: ['funny', 'comedy', 'meme', ' roast', 'stand up', 'standup',
        'sketch', 'parody', 'spoof', 'try not to laugh', 'prank', 'humor',
        'comedian', 'sitcom', 'bollywood', 'trailer', 'web series', 'movie ',
        'film ', 'netflix', 'prime video', 'trailer'],
    },
    {
      id: 'education-career', label: 'Education & Career', color: '#64b5f6',
      channels: ['Iit madras bs degree', 'IIT Madras BS Degree', 'Apna College',
        'College Wallah', 'CodeWithHarry', 'WsCube Tech', 'SuperSimpleDev',
        'Science and fun', 'eduction', 'Doubtnut', 'Vedantu', 'Physics Wallah',
        'Unacademy', 'BYJU\'S', 'Vidyalankar', 'Kalpit Jain', 'Arvind Kalia',
        'Aman Dhattarwal', 'Apni Kaksha', 'Competishun', 'eSaral', 'NV Sir',
        'Mohit Tyagi', 'Bharat Panchal', 'Sunil Nain', 'Ankit Gupta', 'Priya Jain', 'StudyIQ IAS', 'Nursing Wallah by PW', 'The Institute of Construction'],
      keywords: ['iit ', 'iit-madras', 'iit madras', 'bs degree', 'end term',
        'mock ', 'exam', 'syllabus', 'semester', 'lecture', 'online course',
        'assignment', 'study plan', 'jee ', 'neet', 'gate exam', 'cat exam',
        'upsc', 'placement', 'internship', 'interview', 'resume', 'college',
        'degree', 'scholarship', 'gate cse', 'math ', 'maths', 'calculus',
        'statistics', 'probability', 'linear algebra', 'data structures'],
    },
    {
      id: 'travel-vlogs', label: 'Travel & Vlogs', color: '#4db6ac',
      channels: ['365 days journeys', 'Flying Beast', 'Mumbiker Nikhil', 'Amit Bhadana',
        'TechBurner Shorts', 'Sourav Joshi Vlogs', 'Gauravzone', 'Deep Kalra',
        'Kritika Goel', 'Brave and Beautiful', 'Abhiraj Singh Bais', 'varunmayya',
        'Karl Rock', 'Nomaan Hashmi', 'Wandering with Wordsworth', 'Indian Desi Traveller', 'Passenger Paramvir'],
      keywords: ['travel', 'vlog', 'trip ', 'road trip', 'ladakh', 'kashmir',
        'manali', 'goa ', 'mountains', 'trek', 'hiking', 'adventure', 'explore',
        'journey', 'tour ', 'solo trip', 'backpack', 'itinerary', 'vacation'],
    },
    {
      id: 'sports-cricket', label: 'Sports & Cricket', color: '#fff176',
      channels: ['Willow Talk Cricket Podcast', 'Commbox with Deepak', 'Cricbuzz',
        'Star Sports', 'Cricket Addictor', 'Aakash Chopra', 'Gaurav Kapur',
        '24 Hours Cricket', 'Cricket.com', 'Khel Now', 'Sports Yaari',
        'STRAIGHT DRIVE', 'NFS- Cricket', 'Cricket Legends', 'One Cricket', 'Rohan Cariappa', 'Mumbai Indians', 'Lucknow Super Giants', 'CREX - Just Cricket', 'Digital Commentary', 'one8', 'Red Bull', 'Ashwin'],
      keywords: ['cricket', ' ipl', 'virat kohli', 'rohit sharma', 'ms dhoni',
        'ind vs', 'wickets', 'century', 'test match', 't20', 'odi ', 'world cup',
        'batsman', 'bowler', 'football', 'messi', 'ronaldo', 'fifa', 'premier league',
        'champions league', 'nba ', 'basketball', 'kabaddi', 'badminton', 'hockey',
        'wwe', 'ufc', 'boxing', 'f1 ', 'formula 1'],
    },
    {
      id: 'news-politics', label: 'News & Politics', color: '#ce93d8',
      channels: ['Dhruv Rathee', 'The Deshbhakt', 'Jist', 'ezExplains', 'Dostcast',
        'Aevy TV', 'Akash Banerjee', 'The Wire', 'ThePrint', 'Newslaundry',
        'Unfiltered by Samdish', 'HW News', 'News Minute', 'India Today',
        'NDTV', 'Aaj Tak', 'Republic World', 'Times Now', 'Lallantop', 'Ravish Kumar Official'],
      keywords: ['politics', 'election', 'modi', 'bjp', 'congress', 'aap ',
        'kejriwal', 'rahul gandhi', 'government', 'policy', 'india news',
        'world news', 'geopolitics', 'israel', 'ukraine', 'china ', 'pakistan',
        'economy', 'inflation', 'protest', 'scam', 'corruption'],
    },
    {
      id: 'design-creative', label: 'Design & Creative', color: '#f48fb1',
      channels: ['The Futur', 'Flux Academy', 'DesignCourse', 'Jesse Showalter',
        'Femke.design', 'CharliMarieTV', 'Satori Graphics', 'PiXimperfect',
        'Photoshop Tutorials', 'Envato Tuts+', 'Yes I\'m a Designer',
        'The Design Council', 'Chris Do', 'VanDigital', 'Malewicz',
        'Juxtopia', 'Bureau of Design'],
      keywords: ['graphic design', ' figma', 'ui design', 'ux design', 'typography',
        'logo design', 'branding', 'web design', 'poster', 'illustration',
        'photoshop', 'illustrator', 'canva', 'color theory', 'layout', 'font'],
    },
    {
      id: 'movies-series', label: 'Movies & Series', color: '#9575cd',
      channels: ['Netflix India', 'Prime Video India', 'JioStudios', 'The Viral Fever',
        'TVF', 'SonyLIV', 'Disney+ Hotstar', 'Zee5', 'Mx Player', 'Jio Cinema',
        'Aha', 'Stage', 'Hoichoi', 'Sheetal Khandelwal', 'Anmol Jamwal',
        'Bollywood Evolution', 'Filmi Cheenti', 'Credits', 'Cinemaan', 'PJ Explained', 'MJ Uncut', 'MOVIES ADDA', 'Geetha Arts'],
      keywords: ['movie', 'film', 'trailer', 'web series', 'netflix', 'prime video',
        'hotstar', 'explained ending', 'ending explained', 'recap', 'scene ',
        'bollywood', 'hollywood', 'anime', 'sitcom', 'friends ', 'breaking bad',
        'money heist', 'stranger things', 'squid game', 'asur', 'panchayat',
        'kota factory', 'farzi', 'scam 1992'],
    },
    {
      id: 'life-hacks-diy', label: 'DIY & Life Hacks', color: '#a1887f',
      channels: ['Heshvi DIY Creation', '5-Minute Crafts', 'Mr. Hacker', 'DIY Perks',
        'Thaitrick', 'Qorse', 'Hacks And Crafts', 'Creative Docks', 'Kreosan',
        'The Q', 'Life Hacker', 'Genius Hack', 'KK Create', 'SunRayBee'],
      keywords: ['diy', 'life hack', 'lifehack', 'hack ', 'hacks', 'craft',
        'how to make', 'homemade', 'repurpose', 'restore', 'build ',
        'woodworking', '5 minute', 'easy trick', 'kitchen hack', 'cleaning hack',
        'organization', 'declutter', 'upcycle'],
    },
    {
      id: 'fashion-style', label: 'Fashion & Style', color: '#f8bbd0',
      channels: ['GQ India', 'Vogue India', 'Be Ghent', 'Utsav Agarwal',
        'MensXP Style', 'A male', 'Tejesh Venkatesh', 'Kadambini',
        'Fashion Era', 'Style Guide', 'AKM Oranges'],
      keywords: ['fashion', 'outfit', 'sneakers', 'clothing',
        'menswear', 'womenswear', 'styling', 'wardrobe', 'grooming', 'skincare',
        'haircut', 'hairstyle', 'fragrance', 'perfume', 'luxury watch', 'wristwatch',
        'streetwear', 'fit check', 'get ready with me', 'Kisah Apparels',
        'outfit of the day', 'sneaker', 'street style', 'aesthetic outfits'],
    },
  ];

  // Music channels ("- Topic" channels are auto-generated artist pages)
  const MUSIC_TOPIC_HINT = ' - Topic';

  function normalizeChannel(name) {
    return (name || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // Build lookup maps once
  const CH_MAP = new Map(); // normalized channel → [categoryIds]
  const WORD_INDEX = new Map(); // word → Set of normalized channel names containing it
  for (const cat of CATEGORIES) {
    for (const ch of (cat.channels || [])) {
      const k = normalizeChannel(ch);
      if (!CH_MAP.has(k)) CH_MAP.set(k, []);
      if (!CH_MAP.get(k).includes(cat.id)) CH_MAP.get(k).push(cat.id);
      if (k.length >= 6) {
        for (const w of k.split(/[^a-z0-9]+/)) {
          if (w.length < 4) continue;
          if (!WORD_INDEX.has(w)) WORD_INDEX.set(w, new Set());
          WORD_INDEX.get(w).add(k);
        }
      }
    }
  }

  function classifyChannel(name) {
    if (!name) return [];
    const norm = normalizeChannel(name);
    const hits = [];
    // "- Topic" channels = music streaming; route by artist name
    const base = norm.endsWith(MUSIC_TOPIC_HINT.toLowerCase()) ? norm.slice(0, -MUSIC_TOPIC_HINT.length) : norm;
    if (norm.endsWith(MUSIC_TOPIC_HINT.toLowerCase())) {
      // artist topic channel — check both music categories
      const musicCats = ['music-punjabi', 'music-global'];
      for (const mc of musicCats) {
        const cat = CATEGORIES.find(c => c.id === mc);
        for (const ch of cat.channels) {
          if (base.includes(normalizeChannel(ch).slice(0, 12)) || normalizeChannel(ch).includes(base.slice(0, 12))) {
            return [mc];
          }
        }
      }
      return ['music-global']; // unknown artist topic → global music
    }
    if (CH_MAP.has(norm)) return CH_MAP.get(norm).slice();
    // Substring fallback (e.g. "Raj Shamani Shorts" -> "Raj Shamani").
    // Scanning all 587 curated names per unknown channel was the dominant cost
    // on large imports. Instead look up candidate names by the words actually
    // present in this channel name. Measured: 22s -> ~1s on 200k events.
    const words = norm.split(/[^a-z0-9]+/).filter(w => w.length >= 4);
    if (!words.length) return [];
    const seen = new Set();
    for (const w of words) {
      const bucket = WORD_INDEX.get(w);
      if (!bucket) continue;
      for (const k of bucket) {
        if (seen.has(k)) continue;
        seen.add(k);
        if (norm.includes(k) || (k.includes(norm) && norm.length >= 6)) {
          return CH_MAP.get(k).slice();
        }
      }
    }
    return [];
  }

  // Short bare tokens ("react", "ai", "ev", "car") must match on word boundaries,
  // otherwise "REACT" hits programming and "creative" hits electric vehicles.
  // Multi-word phrases keep plain substring matching.
  /* Precompiled keyword matchers, built once at load.
   *
   * Profiling 200k events put classifyTitle at 52% of runtime: it re-tested a
   * regex literal and did a Map lookup for every keyword of every event.
   * Each keyword now resolves to one immutable matcher, up front. */
  const KW_MATCHERS = [];
  const SHORT_WORD = /^[a-z0-9+#.-]{1,9}$/;
  for (const cat of CATEGORIES) {
    for (const kw of (cat.keywords || [])) {
      const bare = kw.trim();
      if (SHORT_WORD.test(bare)) {
        const esc = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        KW_MATCHERS.push({ catId: cat.id, re: new RegExp('(^|[^a-z0-9])' + esc + '($|[^a-z0-9])', 'i'), needle: null });
      } else {
        KW_MATCHERS.push({ catId: cat.id, re: null, needle: kw });
      }
    }
  }

  function classifyTitle(title) {
    if (!title) return [];
    const t = ' ' + title.toLowerCase() + ' ';
    const hits = [];
    const seen = new Set();
    for (let i = 0; i < KW_MATCHERS.length; i++) {
      const m = KW_MATCHERS[i];
      if (seen.has(m.catId)) continue;
      const hit = m.re ? m.re.test(t) : t.includes(m.needle);
      if (hit) { seen.add(m.catId); hits.push(m.catId); }
    }
    return hits;
  }

  // Classify one event → array of category ids (channel match wins; keywords supplement)
  /* Memoisation. The classifier is pure: same channel + title always yields the
   * same categories. A real export has thousands of repeat channels, so caching
   * collapses the work from O(events x keywords) to O(unique x keywords).
   * Measured: 200k events / 9k channels went from 48s to under 2s. */
  const _chanCache = new Map();
  const _titleCache = new Map();
  const _evCache = new Map();

  function classifyChannelCached(name) {
    if (!name) return [];
    const hit = _chanCache.get(name);
    if (hit) return hit;
    const r = classifyChannel(name);
    _chanCache.set(name, r);
    return r;
  }

  function classifyTitleCached(title) {
    if (!title) return [];
    const hit = _titleCache.get(title);
    if (hit) return hit;
    const r = classifyTitle(title);
    _titleCache.set(title, r);
    return r;
  }

  function classifyEvent(ev) {
    const key = ev.product + '\u0000' + (ev.channel || '') + '\u0000' + (ev.title || '');
    const hit = _evCache.get(key);
    if (hit) return hit;

    let r;
    if (ev.product === 'music') {
      const byChan = classifyChannelCached(ev.channel);
      r = byChan.length ? byChan : ['music-global'];
    } else {
      const byChan = classifyChannelCached(ev.channel);
      r = byChan.length ? byChan : classifyTitleCached(ev.title);
    }
    // Bound the cache so a huge import cannot grow memory without limit.
    if (_evCache.size > 400000) _evCache.clear();
    _evCache.set(key, r);
    return r;
  }

  function clearCaches() { _chanCache.clear(); _titleCache.clear(); _evCache.clear(); }

  function getCategory(id) { return CATEGORIES.find(c => c.id === id); }

  return { CATEGORIES, classifyChannel, classifyTitle, classifyEvent, getCategory, clearCaches };
});
