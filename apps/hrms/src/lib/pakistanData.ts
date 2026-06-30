export const pakistanProvinces = [
  'Punjab',
  'Sindh',
  'Khyber Pakhtunkhwa',
  'Balochistan',
  'Gilgit-Baltistan',
  'Azad Jammu & Kashmir',
  'Islamabad Capital Territory',
]

export const pakistanCities: Record<string, string[]> = {
  Punjab: [
    'Lahore', 'Faisalabad', 'Rawalpindi', 'Gujranwala', 'Multan',
    'Bahawalpur', 'Sargodha', 'Sialkot', 'Sheikhupura', 'Jhang',
    'Rahim Yar Khan', 'Gujrat', 'Kasur', 'Sahiwal', 'Okara',
    'Wah Cantonment', 'Dera Ghazi Khan', 'Muzaffargarh', 'Mirpur Khas',
    'Nawabshah', 'Mingora', 'Chiniot', 'Kamoke', 'Hafizabad',
    'Sadiqabad', 'Khanewal', 'Pakpattan', 'Mandi Bahauddin',
    'Lodhran', 'Vehari', 'Attock', 'Chakwal', 'Jhelum',
    'Bhakkar', 'Layyah', 'Mianwali', 'Khushab', 'Toba Tek Singh',
    'Nankana Sahib', 'Narowal', 'Shujabad',
    'Kabirwala', 'Mailsi', 'Burewala', 'Arifwala', 'Chunian',
  ],
  Sindh: [
    'Karachi', 'Hyderabad', 'Sukkur', 'Larkana', 'Nawabshah',
    'Mirpur Khas', 'Jacobabad', 'Shikarpur', 'Khairpur', 'Dadu',
    'Thatta', 'Badin', 'Sanghar', 'Umerkot', 'Tharparkar',
    'Matiari', 'Jamshoro', 'Kashmore', 'Ghotki', 'Tando Allahyar',
  ],
  'Khyber Pakhtunkhwa': [
    'Peshawar', 'Mardan', 'Mingora', 'Kohat', 'Abbottabad',
    'Mansehra', 'Dera Ismail Khan', 'Charsadda', 'Nowshera',
    'Haripur', 'Bannu', 'Lakki Marwat', 'Karak', 'Hangu',
    'Chitral', 'Dir', 'Buner', 'Swabi', 'Malakand', 'Tank',
  ],
  Balochistan: [
    'Quetta', 'Turbat', 'Khuzdar', 'Hub', 'Chaman', 'Zhob',
    'Gwadar', 'Dera Murad Jamali', 'Loralai', 'Pishin',
    'Nushki', 'Mastung', 'Kalat', 'Sibi', 'Dera Allah Yar',
  ],
  'Gilgit-Baltistan': [
    'Gilgit', 'Skardu', 'Ghanche', 'Astore', 'Diamer',
    'Ghizer', 'Hunza', 'Nagar',
  ],
  'Azad Jammu & Kashmir': [
    'Muzaffarabad', 'Mirpur', 'Rawalakot', 'Bagh', 'Kotli',
    'Bhimber', 'Haveli', 'Neelum', 'Jhelum Valley', 'Sudhnati',
  ],
  'Islamabad Capital Territory': ['Islamabad'],
}

export const pakistanDistricts: Record<string, string[]> = {
  Punjab: [
    'Attock', 'Bahawalnagar', 'Bahawalpur', 'Bhakkar', 'Chakwal',
    'Chiniot', 'Dera Ghazi Khan', 'Faisalabad', 'Gujranwala', 'Gujrat',
    'Hafizabad', 'Jhang', 'Jhelum', 'Kasur', 'Khanewal', 'Khushab',
    'Lahore', 'Layyah', 'Lodhran', 'Mandi Bahauddin', 'Mianwali',
    'Multan', 'Muzaffargarh', 'Nankana Sahib', 'Narowal', 'Okara',
    'Pakpattan', 'Rahim Yar Khan', 'Rawalpindi', 'Sahiwal', 'Sargodha',
    'Sheikhupura', 'Sialkot', 'Toba Tek Singh', 'Vehari',
  ],
  Sindh: [
    'Badin', 'Dadu', 'Ghotki', 'Hyderabad', 'Jacobabad', 'Jamshoro',
    'Karachi', 'Kashmore', 'Khairpur', 'Larkana', 'Matiari',
    'Mirpur Khas', 'Naushahro Feroze', 'Sanghar', 'Shaheed Benazirabad',
    'Shikarpur', 'Sukkur', 'Tando Allahyar', 'Tando Muhammad Khan',
    'Tharparkar', 'Thatta', 'Umerkot',
  ],
  'Khyber Pakhtunkhwa': [
    'Abbottabad', 'Bajaur', 'Bannu', 'Batagram', 'Buner', 'Charsadda',
    'Chitral', 'Dera Ismail Khan', 'Hangu', 'Haripur', 'Karak',
    'Kohat', 'Kohistan', 'Lakki Marwat', 'Lower Dir', 'Malakand',
    'Mansehra', 'Mardan', 'Nowshera', 'Peshawar', 'Shangla',
    'Swabi', 'Swat', 'Tank', 'Upper Dir',
  ],
  Balochistan: [
    'Awaran', 'Barkhan', 'Chagai', 'Dera Bugti', 'Gwadar', 'Harnai',
    'Jaffarabad', 'Kalat', 'Kech', 'Kharan', 'Khuzdar', 'Killa Abdullah',
    'Kohlu', 'Lasbela', 'Loralai', 'Mastung', 'Musakhel', 'Nasirabad',
    'Nushki', 'Panjgur', 'Pishin', 'Quetta', 'Sibi', 'Washuk',
    'Zhob', 'Ziarat',
  ],
  'Gilgit-Baltistan': [
    'Astore', 'Diamer', 'Ghanche', 'Ghizer', 'Gilgit',
    'Hunza', 'Nagar', 'Skardu', 'Shigar',
  ],
  'Azad Jammu & Kashmir': [
    'Bagh', 'Bhimber', 'Hattian Bala', 'Haveli', 'Kotli',
    'Mirpur', 'Muzaffarabad', 'Neelum', 'Poonch', 'Rawalkot', 'Sudhnati',
  ],
  'Islamabad Capital Territory': ['Islamabad'],
}

export const punjabTehsils: Record<string, string[]> = {
  Multan: [
    'Multan City', 'Multan Saddar', 'Shujabad', 'Jalalpur Pirwala',
    'Sher Shah',
  ],
  Lahore: ['Lahore City', 'Raiwind', 'Shalimar'],
  Faisalabad: [
    'Faisalabad City', 'Jaranwala', 'Samundri', 'Tandlianwala', 'Chak Jhumra',
  ],
  Rawalpindi: [
    'Rawalpindi', 'Gujar Khan', 'Kahuta', 'Murree', 'Taxila',
  ],
  Gujranwala: ['Gujranwala', 'Kamoke', 'Nowshera Virkan', 'Wazirabad'],
  Sargodha: ['Sargodha', 'Bhalwal', 'Kot Momin', 'Shahpur', 'Sillanwali'],
  Bahawalpur: [
    'Bahawalpur', 'Ahmadpur East', 'Hasilpur', 'Khairpur Tamewali',
  ],
  'Rahim Yar Khan': [
    'Rahim Yar Khan', 'Liaquatpur', 'Sadiqabad', 'Khan Pur',
  ],
  Sialkot: ['Sialkot', 'Daska', 'Pasrur', 'Sambrial'],
  'Dera Ghazi Khan': ['Dera Ghazi Khan', 'Taunsa', 'Kot Chutta', 'Vehova'],
}
